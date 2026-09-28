import { and, eq, lte, sql } from "drizzle-orm";
import { integrations, purchases } from "@/db/schema";
import { readTid } from "@/lib/inbound";
import { errorFields, log } from "@/lib/log";
import { normalizeCurrency, toMinorUnits } from "@/lib/money";
import { normalizeEmail } from "@/lib/email";
import { type EmitInput, emitEventSafely, kickWith } from "@/server/integrations/events";
import { recordOptIn, recordPurchase } from "@/server/integrations/inbound";
import { GhlApiError, type GhlApi, type GhlContact, type GhlOpportunity, type GhlTransaction } from "@/server/ghl/api";
import { type GhlConfig, type GhlDeps, GhlReauthError, updateGhlConfig, withGhlApi } from "@/server/ghl/tokens";
import type { Enqueue } from "./polling";

// GoHighLevel connector, worker side (SPEC section 14, DECISIONS Q-05, Q-06):
// setup once, then a sync every 5 minutes plus marketplace webhooks. All API
// calls happen here, never in a web request.

export interface GhlWorkerDeps extends GhlDeps {
  enqueue: Enqueue;
}

const SYNC_INTERVAL_MS = 5 * 60_000;
const SETUP_RETRY_MS = 10 * 60_000;
const OPPORTUNITIES_INTERVAL_MS = 60 * 60_000;
const DEEP_INTERVAL_MS = 24 * 3_600_000;
const FIRST_CONTACT_WINDOW_MS = 14 * 86_400_000;
const FIRST_PAYMENT_WINDOW_MS = 90 * 86_400_000;
const PAYMENT_OVERLAP_MS = 2 * 86_400_000;
const MAX_CONTACT_PAGES = 10;
const MAX_OPPORTUNITY_PAGES = 20;
const MAX_TRANSACTION_PAGES = 50;
// Statuses that mean money was actually collected (a refund is subtracted).
const PAID_STATUSES = new Set(["succeeded", "paid", "completed", "partially_refunded", "refunded"]);

function emitter(deps: GhlWorkerDeps) {
  return (input: EmitInput) => emitEventSafely(deps.db, input, kickWith(deps.enqueue));
}

function asDate(value: string | undefined, fallback: Date): Date {
  const parsed = value ? new Date(value) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : fallback;
}

// Once after connecting: the c2c_tid contact field (created, or found if the
// creator already made one), the location name; then the first sync.
export async function setupGhl(deps: GhlWorkerDeps, integrationId: string): Promise<void> {
  const now = deps.now?.() ?? new Date();
  let name: string | null = null;
  await withGhlApi(deps, integrationId, async (api, config) => {
    const location =
      config.locationName && config.locationWebsite !== undefined
        ? { name: config.locationName, website: config.locationWebsite }
        : await api.getLocation(config.locationId).catch((error: unknown) => {
            log("warn", "ghl sub-account lookup failed, name and website left empty", { integrationId, ...errorFields(error) });
            return { name: null, website: null };
          });
    const locationName = config.locationName ?? location.name;
    const locationWebsite = location.website;
    name = locationName;
    let customFieldId = config.customFieldId;
    if (!customFieldId) {
      const fields = await api.listContactFields(config.locationId);
      const existing = fields.find((f) => f.fieldKey === "contact.c2c_tid" || f.name?.trim().toLowerCase() === "c2c_tid");
      customFieldId = (existing ?? (await api.createContactField(config.locationId, "c2c_tid"))).id;
    }
    await updateGhlConfig(deps, integrationId, { customFieldId, locationName, locationWebsite });
  });
  await deps.db
    .update(integrations)
    .set({
      syncState: sql`${integrations.syncState} || '{"setup":"done"}'::jsonb`,
      label: name ? `GoHighLevel: ${name}` : "GoHighLevel",
      lastError: null,
      nextSyncAt: now,
      updatedAt: now,
    })
    .where(eq(integrations.id, integrationId));
  log("info", "ghl setup done", { integrationId });
}

// Every minute from the engine tick: queue setups and syncs that are due.
export async function queueGhlWork(deps: GhlWorkerDeps): Promise<void> {
  const now = deps.now?.() ?? new Date();
  const due = await deps.db
    .select({ id: integrations.id, syncState: integrations.syncState })
    .from(integrations)
    .where(and(eq(integrations.type, "ghl"), eq(integrations.status, "active"), lte(integrations.nextSyncAt, now)));
  for (const row of due) {
    const setupDone = row.syncState.setup === "done";
    // Claim the slot first so the next tick does not queue it twice.
    const claimed = await deps.db
      .update(integrations)
      .set({ nextSyncAt: new Date(now.getTime() + (setupDone ? SYNC_INTERVAL_MS : SETUP_RETRY_MS)) })
      .where(and(eq(integrations.id, row.id), lte(integrations.nextSyncAt, now)))
      .returning({ id: integrations.id });
    if (claimed.length === 0) continue;
    await deps.enqueue(setupDone ? "ghl.sync" : "ghl.setup", { integrationId: row.id }, { singletonKey: row.id });
  }
}

interface ContactShape {
  id: string;
  email: string | null;
  name: string | null;
  tags: string[];
  tid: string | null;
  addedAt: Date;
}

function readContact(config: GhlConfig, contact: GhlContact, fallbackDate: Date): ContactShape {
  const field = config.customFieldId ? contact.customFields?.find((f) => f.id === config.customFieldId)?.value : undefined;
  const utm = contact.attributionSource?.utmContent ?? contact.lastAttributionSource?.utmContent ?? undefined;
  const name = contact.contactName ?? contact.name ?? ([contact.firstName, contact.lastName].filter(Boolean).join(" ") || null);
  return {
    id: contact.id,
    email: contact.email ? normalizeEmail(contact.email) : null,
    name: name ? name.slice(0, 200) : null,
    tags: contact.tags ?? [],
    // The custom field first, then utm_content (CC-07 layer 1) for creators who
    // never added the field to their form.
    tid: readTid({ tid: typeof field === "string" ? field : undefined, utm_content: utm }),
    addedAt: asDate(contact.dateAdded, fallbackDate),
  };
}

// A buyer known only from a tag or a won opportunity: counted as a buyer,
// revenue not reported. Skipped when this email already has any purchase.
async function markBuyer(deps: GhlWorkerDeps, accountId: string, input: { email: string; externalId: string; contactId: string | null; at: Date }): Promise<void> {
  const [existing] = await deps.db
    .select({ id: purchases.id })
    .from(purchases)
    .where(and(eq(purchases.accountId, accountId), eq(purchases.emailNorm, input.email)))
    .limit(1);
  if (existing) return;
  await recordPurchase(
    deps.db,
    accountId,
    { email: input.email, tid: null, externalId: input.externalId, amountCents: null, currency: null, refundedCents: null, subscriptionId: null, occurredAt: input.at },
    { source: "ghl", ghlContactId: input.contactId, emit: emitter(deps) },
  );
}

async function processContact(deps: GhlWorkerDeps, accountId: string, config: GhlConfig, contact: ContactShape): Promise<void> {
  if (!contact.email) return;
  const now = deps.now?.() ?? new Date();
  if (contact.tid) {
    await recordOptIn(
      deps.db,
      accountId,
      { email: contact.email, name: contact.name, tid: contact.tid, externalId: null, consentMarketing: null, occurredAt: contact.addedAt > now ? now : contact.addedAt },
      { source: "ghl", ghlContactId: contact.id, emit: emitter(deps) },
    );
  }
  const buyerTag = config.buyerTag.trim().toLowerCase();
  if (buyerTag && contact.tags.some((tag) => tag.trim().toLowerCase() === buyerTag)) {
    await markBuyer(deps, accountId, { email: contact.email, externalId: `tag:${contact.id}`, contactId: contact.id, at: now });
  }
}

async function integrationAccount(deps: GhlWorkerDeps, integrationId: string) {
  const [row] = await deps.db.select().from(integrations).where(eq(integrations.id, integrationId));
  return row && row.status === "active" ? row : null;
}

async function syncContacts(deps: GhlWorkerDeps, api: GhlApi, accountId: string, config: GhlConfig, state: Record<string, unknown>, now: Date): Promise<string> {
  const since = typeof state.contactsCursor === "string" ? new Date(state.contactsCursor) : new Date(now.getTime() - FIRST_CONTACT_WINDOW_MS);
  let newest = since;
  let page: { startAfterId?: string; startAfter?: string | number } = {};
  for (let i = 0; i < MAX_CONTACT_PAGES; i += 1) {
    const { contacts, next } = await api.listContacts(config.locationId, page);
    let reachedCursor = false;
    for (const raw of contacts) {
      const contact = readContact(config, raw, now);
      if (contact.addedAt <= since) {
        reachedCursor = true;
        continue;
      }
      if (contact.addedAt > newest) newest = contact.addedAt;
      await processContact(deps, accountId, config, contact);
    }
    if (reachedCursor || !next || contacts.length === 0) break;
    page = next;
  }
  return newest.toISOString();
}

async function contactEmailFor(api: GhlApi, cache: Map<string, string | null>, contactId: string | undefined): Promise<string | null> {
  if (!contactId) return null;
  if (!cache.has(contactId)) {
    const contact = await api.getContact(contactId);
    cache.set(contactId, contact?.email ? normalizeEmail(contact.email) : null);
  }
  return cache.get(contactId) ?? null;
}

async function syncOpportunities(deps: GhlWorkerDeps, api: GhlApi, accountId: string, config: GhlConfig, emails: Map<string, string | null>, now: Date): Promise<void> {
  for (let page = 1; page <= MAX_OPPORTUNITY_PAGES; page += 1) {
    const { opportunities, hasMore } = await api.listWonOpportunities(config.locationId, page);
    for (const opp of opportunities) await markWon(deps, api, accountId, opp, emails, now);
    if (!hasMore || opportunities.length === 0) break;
  }
}

// Won opportunity: a buyer, never revenue (DECISIONS Q-06).
async function markWon(deps: GhlWorkerDeps, api: GhlApi, accountId: string, opp: GhlOpportunity, emails: Map<string, string | null>, now: Date): Promise<void> {
  const contactId = opp.contactId ?? opp.contact?.id;
  const email = opp.contact?.email ? normalizeEmail(opp.contact.email) : await contactEmailFor(api, emails, contactId);
  if (!email) return;
  await markBuyer(deps, accountId, { email, externalId: `opp:${opp.id}`, contactId: contactId ?? null, at: asDate(opp.lastStatusChangeAt ?? opp.updatedAt, now) });
}

function refundedOf(tx: GhlTransaction, amountCents: number, currency: string): number | null {
  const sum = (tx.refunds ?? []).reduce((total, refund) => total + (toMinorUnits(String(refund.amount ?? 0), currency) ?? 0), 0);
  if (sum > 0) return Math.min(sum, amountCents);
  return tx.status === "refunded" ? amountCents : null;
}

async function syncTransactions(deps: GhlWorkerDeps, api: GhlApi, accountId: string, config: GhlConfig, emails: Map<string, string | null>, from: Date, now: Date): Promise<void> {
  for (let pageIndex = 0; pageIndex < MAX_TRANSACTION_PAGES; pageIndex += 1) {
    const { transactions } = await api.listTransactions(config.locationId, { startAt: from, endAt: now, offset: pageIndex * 100 });
    for (const tx of transactions) {
      if (!tx._id || !PAID_STATUSES.has((tx.status ?? "").toLowerCase())) continue;
      const currency = normalizeCurrency(tx.currency);
      const amountCents = currency && tx.amount !== undefined ? toMinorUnits(String(tx.amount), currency) : null;
      if (!currency || amountCents === null || amountCents === 0) continue;
      const email = tx.contactEmail ? normalizeEmail(tx.contactEmail) : await contactEmailFor(api, emails, tx.contactId);
      if (!email) continue;
      await recordPurchase(
        deps.db,
        accountId,
        {
          email,
          tid: null,
          externalId: tx._id,
          amountCents,
          currency,
          refundedCents: refundedOf({ ...tx, status: (tx.status ?? "").toLowerCase() }, amountCents, currency),
          subscriptionId: tx.subscriptionId ?? null,
          occurredAt: asDate(tx.createdAt, now),
        },
        { source: "ghl", ghlContactId: tx.contactId ?? null, raw: tx as unknown as Record<string, unknown>, emit: emitter(deps) },
      );
    }
    if (transactions.length < 100) break;
  }
}

// Reads new contacts (opt-ins with a c2c_tid, buyer tags), won opportunities
// (hourly) and payments (every run, plus a 90 day pass daily for refunds).
export async function syncGhl(deps: GhlWorkerDeps, integrationId: string): Promise<void> {
  const row = await integrationAccount(deps, integrationId);
  if (!row || row.syncState.setup !== "done") return;
  const now = deps.now?.() ?? new Date();
  const state = { ...row.syncState };
  const errors: string[] = [];

  try {
    await withGhlApi(deps, integrationId, async (api, config) => {
      const emails = new Map<string, string | null>();
      const step = async (name: string, run: () => Promise<void>) => {
        try {
          await run();
        } catch (error) {
          if (error instanceof GhlReauthError) throw error;
          errors.push(`${name}: ${error instanceof GhlApiError ? `HTTP ${error.status}` : String(error)}`);
          log("warn", "ghl sync step failed", { integrationId, step: name, ...errorFields(error) });
        }
      };
      await step("contacts", async () => {
        state.contactsCursor = await syncContacts(deps, api, row.accountId, config, state, now);
      });
      const oppAt = typeof state.oppAt === "string" ? new Date(state.oppAt).getTime() : 0;
      if (now.getTime() - oppAt >= OPPORTUNITIES_INTERVAL_MS) {
        await step("opportunities", async () => {
          await syncOpportunities(deps, api, row.accountId, config, emails, now);
          state.oppAt = now.toISOString();
        });
      }
      const deepAt = typeof state.deepAt === "string" ? new Date(state.deepAt).getTime() : 0;
      const deep = now.getTime() - deepAt >= DEEP_INTERVAL_MS;
      const txCursor = typeof state.txCursor === "string" ? new Date(state.txCursor) : null;
      const from = deep || !txCursor ? new Date(now.getTime() - FIRST_PAYMENT_WINDOW_MS) : new Date(txCursor.getTime() - PAYMENT_OVERLAP_MS);
      await step("payments", async () => {
        await syncTransactions(deps, api, row.accountId, config, emails, from, now);
        state.txCursor = now.toISOString();
        if (deep) state.deepAt = now.toISOString();
      });
    });
  } catch (error) {
    if (error instanceof GhlReauthError) return;
    throw error;
  }

  await deps.db
    .update(integrations)
    .set({
      syncState: state,
      lastSyncedAt: now,
      ...(errors.length === 0 ? { lastSuccessAt: now, lastError: null } : { lastError: errors.join("; ").slice(0, 400) }),
      nextSyncAt: new Date(now.getTime() + SYNC_INTERVAL_MS),
      updatedAt: now,
    })
    .where(eq(integrations.id, integrationId));
}

// A verified marketplace webhook (src/app/api/hooks/crm). The contact is read
// back through the API so every event type ends up with the same shape.
export async function handleGhlEvent(deps: GhlWorkerDeps, integrationId: string, payload: Record<string, unknown>): Promise<void> {
  const row = await integrationAccount(deps, integrationId);
  if (!row || row.syncState.setup !== "done") return;
  const now = deps.now?.() ?? new Date();
  const type = String(payload.type ?? payload.event ?? "");
  const str = (value: unknown) => (typeof value === "string" && value !== "" ? value : undefined);
  try {
    await withGhlApi(deps, integrationId, async (api, config) => {
      if (type === "ContactCreate" || type === "ContactUpdate" || type === "ContactTagUpdate") {
        const id = str(payload.id) ?? str(payload.contactId);
        if (!id) return;
        const contact = (await api.getContact(id)) ?? { id, email: str(payload.email), tags: Array.isArray(payload.tags) ? (payload.tags as string[]) : [] };
        await processContact(deps, row.accountId, config, readContact(config, contact, now));
      } else if (type === "OpportunityStatusUpdate" && String(payload.status ?? "").toLowerCase() === "won") {
        await markWon(deps, api, row.accountId, { id: String(payload.id ?? ""), contactId: str(payload.contactId), updatedAt: now.toISOString() }, new Map(), now);
      }
    });
  } catch (error) {
    if (!(error instanceof GhlReauthError)) throw error;
  }
}

// The note of the workflow action (P10-05). A refused connection is dropped:
// the creator already gets the reconnect email.
export async function addContactNote(deps: GhlWorkerDeps, integrationId: string, ghlContactId: string, text: string): Promise<void> {
  try {
    await withGhlApi(deps, integrationId, (api, config) => api.addNote(ghlContactId, text, config.userId));
  } catch (error) {
    if (!(error instanceof GhlReauthError)) throw error;
  }
}

// Outbox target (see webhooks.ts): a subscriber or buyer that came from a
// comment gets the contact upserted, the c2c_tid field set and the tags added.
export async function deliverToGhl(deps: GhlWorkerDeps, integrationId: string, payload: Record<string, unknown>): Promise<{ skipped: string | null }> {
  const email = typeof payload.email === "string" ? payload.email : null;
  const tags = Array.isArray(payload.tags) ? payload.tags.filter((t): t is string => typeof t === "string") : [];
  // Contacts that cannot be traced to a comment are not ours to tag.
  if (!email || typeof payload.keyword !== "string" || tags.length === 0) return { skipped: "not_attributed" };
  const tid = typeof payload.tid === "string" ? payload.tid : null;
  await withGhlApi(deps, integrationId, async (api, config) => {
    const contactId = await api.upsertContact(config.locationId, {
      email,
      customFields: tid && config.customFieldId ? [{ id: config.customFieldId, value: tid }] : undefined,
    });
    await api.addTags(contactId, tags);
  });
  return { skipped: null };
}
