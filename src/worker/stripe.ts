import { and, eq, lte } from "drizzle-orm";
import type { Db } from "@/db/client";
import { integrations } from "@/db/schema";
import { errorFields, log } from "@/lib/log";
import { mapCharge } from "@/lib/stripe";
import { markReportDirty } from "@/server/attribution";
import { type EmitInput, emitEventSafely, kickWith } from "@/server/integrations/events";
import { recordPurchase } from "@/server/integrations/inbound";
import type { FetchLike } from "@/server/google/oauth";
import { createStripeApi, StripeApiError } from "@/server/stripe/api";
import { readStripeConfig } from "@/server/stripe/connect";
import type { Enqueue } from "./polling";

// Stripe connector, worker side (DECISIONS section 15): a read-only sync every
// 5 minutes with the creator's restricted key. Payments end up in the same
// `purchases` table as every other source, resolved to Contacts (section 13).

// Postgres unique_violation, directly or wrapped by drizzle in `cause`.
export function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: string })?.code ?? (error as { cause?: { code?: string } })?.cause?.code;
  return code === "23505";
}

export interface StripeWorkerDeps {
  db: Db;
  fetch: FetchLike;
  encryptionKey: string;
  enqueue: Enqueue;
  now?: () => Date;
  // Called once when Stripe refuses the key.
  onKeyRejected?: (accountId: string) => Promise<void>;
}

const SYNC_INTERVAL_MS = 5 * 60_000;
const DAY_MS = 86_400_000;
const FIRST_WINDOW_MS = 730 * DAY_MS;
const DEEP_WINDOW_MS = 90 * DAY_MS;
const OVERLAP_MS = 2 * DAY_MS;
const MAX_PAGES = 40;
// Older charges are imported quietly (P8-05): reports, no events.
const QUIET_AFTER_MS = 3 * DAY_MS;

// Every minute from the engine tick: queue the syncs that are due.
export async function queueStripeWork(deps: StripeWorkerDeps): Promise<void> {
  const now = deps.now?.() ?? new Date();
  const due = await deps.db
    .select({ id: integrations.id })
    .from(integrations)
    .where(and(eq(integrations.type, "stripe"), eq(integrations.status, "active"), lte(integrations.nextSyncAt, now)));
  for (const row of due) {
    // Claim the slot first so the next tick does not queue it twice.
    const claimed = await deps.db
      .update(integrations)
      .set({ nextSyncAt: new Date(now.getTime() + SYNC_INTERVAL_MS) })
      .where(and(eq(integrations.id, row.id), lte(integrations.nextSyncAt, now)))
      .returning({ id: integrations.id });
    if (claimed.length > 0) await deps.enqueue("stripe.sync", { integrationId: row.id }, { singletonKey: row.id });
  }
}

interface Resume {
  after: string;
  from: string;
  deep: boolean;
}

async function markRejected(deps: StripeWorkerDeps, integrationId: string, accountId: string, now: Date): Promise<void> {
  const changed = await deps.db
    .update(integrations)
    .set({
      status: "error",
      statusReason: "key_rejected",
      lastError: "Stripe refused the key. Check that it is active and can read Charges, Customers and Invoices, then reconnect.",
      updatedAt: now,
    })
    .where(and(eq(integrations.id, integrationId), eq(integrations.status, "active")))
    .returning({ id: integrations.id });
  if (changed.length > 0 && deps.onKeyRejected) await deps.onKeyRejected(accountId);
}

export async function syncStripe(deps: StripeWorkerDeps, integrationId: string): Promise<void> {
  const [row] = await deps.db.select().from(integrations).where(eq(integrations.id, integrationId));
  if (!row || row.type !== "stripe" || row.status !== "active" || !row.configEnc) return;
  const now = deps.now?.() ?? new Date();
  const config = readStripeConfig(row.configEnc, deps.encryptionKey);
  const api = createStripeApi(deps.fetch, config.apiKey);
  const state: Record<string, unknown> = { ...row.syncState };
  const emit = (input: EmitInput) => emitEventSafely(deps.db, input, kickWith(deps.enqueue));
  const quiet = async () => {};
  let label = row.label;
  let externalRef = row.externalRef;
  let errors = 0;
  let lastError: string | null = null;

  try {
    if (state.setup !== "done") {
      // Reading one charge proves the key works and can read charges.
      await api.listCharges({ gte: now, limit: 1 });
      const account = await api.getAccount();
      label = account?.name ? `Stripe: ${account.name}` : "Stripe";
      if (account?.id && account.id !== externalRef) {
        try {
          await deps.db.update(integrations).set({ externalRef: account.id }).where(eq(integrations.id, integrationId));
          externalRef = account.id;
        } catch (error) {
          // Only the unique index means this Stripe account already feeds
          // another account (P8-07); any other error is a real failure.
          if (!isUniqueViolation(error)) throw error;
          log("warn", "stripe account already connected elsewhere", { integrationId, stripeAccount: account.id });
          await deps.db
            .update(integrations)
            .set({ status: "error", statusReason: "account_taken", lastError: "This Stripe account is already connected to another vidrev account.", updatedAt: now })
            .where(eq(integrations.id, integrationId));
          return;
        }
      }
      state.setup = "done";
    }

    const resume = state.resume as Resume | undefined;
    const deepAt = typeof state.deepAt === "string" ? new Date(state.deepAt).getTime() : 0;
    const cursor = typeof state.cursor === "string" ? new Date(state.cursor) : null;
    const deep = resume ? resume.deep : now.getTime() - deepAt >= DAY_MS;
    const from = resume
      ? new Date(resume.from)
      : !cursor
        ? new Date(now.getTime() - FIRST_WINDOW_MS)
        : deep
          ? new Date(now.getTime() - DEEP_WINDOW_MS)
          : new Date(cursor.getTime() - OVERLAP_MS);

    let after = resume?.after;
    let finished = false;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const { charges, hasMore } = await api.listCharges({ gte: from, startingAfter: after });
      for (const charge of charges) {
        const mapped = mapCharge(charge);
        if (!mapped) continue;
        try {
          await recordPurchase(
            deps.db,
            row.accountId,
            {
              email: mapped.email,
              tid: mapped.tid,
              externalId: mapped.externalId,
              amountCents: mapped.amountCents,
              currency: mapped.currency,
              refundedCents: mapped.refundedCents,
              subscriptionId: mapped.subscriptionId,
              occurredAt: mapped.occurredAt,
            },
            {
              source: "stripe",
              stripeCustomerId: mapped.customerId,
              // Only what the reports need: never card or billing details.
              raw: { id: mapped.externalId, customer: mapped.customerId, amount: mapped.amountCents, currency: mapped.currency, refunded: mapped.refundedCents, subscription: mapped.subscriptionId },
              emit: now.getTime() - mapped.occurredAt.getTime() > QUIET_AFTER_MS ? quiet : emit,
            },
          );
        } catch (error) {
          errors += 1;
          lastError = `charge ${mapped.externalId}: ${String(error)}`.slice(0, 300);
          log("warn", "stripe charge failed", { integrationId, ...errorFields(error) });
        }
      }
      if (!hasMore || charges.length === 0) {
        finished = true;
        break;
      }
      after = charges[charges.length - 1]!.id;
    }
    if (finished) {
      delete state.resume;
      state.cursor = now.toISOString();
      if (deep || !state.deepAt) state.deepAt = now.toISOString();
    } else {
      state.resume = { after: after!, from: from.toISOString(), deep } satisfies Resume;
    }
    // Quiet imports do not emit, so mark the reports stale here.
    await markReportDirty(deps.db, row.accountId, now);
  } catch (error) {
    if (error instanceof StripeApiError && error.keyRejected) {
      await markRejected(deps, integrationId, row.accountId, now);
      return;
    }
    lastError = error instanceof StripeApiError ? `Stripe: ${error.message}`.slice(0, 300) : String(error).slice(0, 300);
    log("warn", "stripe sync failed", { integrationId, ...errorFields(error) });
  }

  await deps.db
    .update(integrations)
    .set({
      label,
      syncState: state,
      lastSyncedAt: now,
      ...(lastError === null && errors === 0 ? { lastSuccessAt: now, lastError: null } : { lastError }),
      nextSyncAt: new Date(now.getTime() + SYNC_INTERVAL_MS),
      updatedAt: now,
    })
    .where(and(eq(integrations.id, integrationId), eq(integrations.status, "active")));
}
