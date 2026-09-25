import { randomBytes, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/db/client";
import { campaigns, channels, clicks, contactIdentities, contacts, integrations, links, outboundDeliveries, purchases } from "@/db/schema";
import { newTid } from "@/lib/links";
import { runMigrations } from "@/scripts/migrate";
import { createAccountWithUser } from "@/server/accounts";
import { runAttribution } from "@/server/attribution";
import { recordOptIn, recordPurchase } from "@/server/integrations/inbound";
import { createEndpoint } from "@/server/integrations/outbound";
import { connectStripe, disconnectStripe, readStripeConfig } from "@/server/stripe/connect";
import { queueStripeWork, syncStripe, type StripeWorkerDeps } from "./stripe";

const hasDb = Boolean(process.env.DATABASE_URL);
const key = randomBytes(32).toString("base64");
const db = () => getDb();
const NOW = new Date("2026-09-26T12:00:00Z");
const unix = (msAgo: number) => Math.floor((NOW.getTime() - msAgo) / 1000);
const HOUR = 3_600_000;
const DAY = 86_400_000;
const restrictedKey = () => `rk_live_${randomUUID().replace(/-/g, "")}`;

interface FakeCharge {
  id: string;
  amount: number;
  currency?: string;
  created: number;
  customer?: unknown;
  invoice?: unknown;
  amount_refunded?: number;
  paid?: boolean;
  status?: string;
  metadata?: Record<string, string>;
  receipt_email?: string;
  billing_details?: { email?: string };
}

// A tiny Stripe: pages of 2 charges, newest first, plus the account endpoint.
function fakeStripe(state: { charges: FakeCharge[]; status?: number; accountId?: string | null; pageSize?: number }) {
  const ownAccountId = `acct_${randomUUID()}`;
  const calls: { url: string; method: string; headers: Record<string, string> }[] = [];
  const fetchImpl = async (input: string, init?: RequestInit): Promise<Response> => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url: input, method: init?.method ?? "GET", headers });
    if (state.status && state.status !== 200) return Response.json({ error: { code: "api_key_expired", message: "Expired API Key provided" } }, { status: state.status });
    const url = new URL(input);
    if (url.pathname === "/v1/account") {
      return state.accountId === null ? Response.json({ error: { message: "no" } }, { status: 403 }) : Response.json({ id: state.accountId ?? ownAccountId, business_profile: { name: "Coach Co" } });
    }
    const gte = Number(url.searchParams.get("created[gte]"));
    const size = Math.min(Number(url.searchParams.get("limit") ?? 100), state.pageSize ?? 100);
    const eligible = state.charges.filter((c) => c.created >= gte).sort((a, b) => b.created - a.created);
    const after = url.searchParams.get("starting_after");
    const start = after ? eligible.findIndex((c) => c.id === after) + 1 : 0;
    const data = eligible.slice(start, start + size).map((c) => ({ currency: "usd", paid: true, status: "succeeded", livemode: true, amount_refunded: 0, ...c, amount_captured: c.amount }));
    return Response.json({ data, has_more: start + size < eligible.length });
  };
  return { fetchImpl, calls };
}

async function setup(stripe: ReturnType<typeof fakeStripe>) {
  const { account } = await createAccountWithUser(db(), { email: `st-${randomUUID()}@example.com`, planCode: "standard_monthly" });
  const connected = await connectStripe(db(), key, account.id, restrictedKey(), NOW);
  if (!connected.ok) throw new Error(connected.error);
  const queued: { queue: string; data: unknown }[] = [];
  const rejected: string[] = [];
  const deps: StripeWorkerDeps = {
    db: db(),
    fetch: stripe.fetchImpl,
    encryptionKey: key,
    enqueue: async (queue, data) => {
      queued.push({ queue, data });
    },
    now: () => NOW,
    onKeyRejected: async (accountId) => {
      rejected.push(accountId);
    },
  };
  return { account, integrationId: connected.id, deps, queued, rejected };
}

const rowsOf = async (accountId: string) => db().select().from(purchases).where(eq(purchases.accountId, accountId));
const live = async (accountId: string) => (await db().select().from(contacts).where(eq(contacts.accountId, accountId))).filter((c) => !c.mergedIntoId);

describe.skipIf(!hasDb)("stripe connector (integration)", () => {
  beforeAll(async () => {
    await runMigrations(process.env.DATABASE_URL!);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("checks the key, names the account and reads payments with read-only GET calls", async () => {
    const stripe = fakeStripe({
      accountId: `acct_${randomUUID()}`,
      charges: [
        { id: "ch_first", amount: 9700, created: unix(40 * DAY), customer: { id: "cus_a", email: "Ann@Example.com" }, invoice: { id: "in_1", subscription: "sub_1" } },
        { id: "ch_renew", amount: 9700, created: unix(10 * DAY), customer: { id: "cus_a", email: "ann@example.com" }, invoice: { id: "in_2", subscription: "sub_1" } },
        { id: "ch_once", amount: 2500, currency: "eur", created: unix(5 * DAY), customer: "cus_b", receipt_email: "bob@example.com" },
        { id: "ch_failed", amount: 999, created: unix(4 * DAY), paid: false, status: "failed" },
      ],
      pageSize: 2,
    });
    const s = await setup(stripe);
    await syncStripe(s.deps, s.integrationId);

    const rows = await rowsOf(s.account.id);
    expect(rows.map((r) => r.externalId).sort()).toEqual(["ch_first", "ch_once", "ch_renew"]);
    expect(rows.find((r) => r.externalId === "ch_once")).toMatchObject({ source: "stripe", amountCents: 2500, currency: "EUR", emailNorm: "bob@example.com", kind: "payment" });
    expect(rows.find((r) => r.externalId === "ch_renew")).toMatchObject({ subscriptionRef: "sub_1", emailNorm: "ann@example.com" });
    // The raw copy keeps only ids and numbers, never card or billing details.
    expect(Object.keys(rows[0]!.raw).sort()).toEqual(["amount", "currency", "customer", "id", "refunded", "subscription"]);

    const [integration] = await db().select().from(integrations).where(eq(integrations.id, s.integrationId));
    expect(integration).toMatchObject({ status: "active", label: "Stripe: Coach Co", lastError: null });
    expect(integration!.syncState.setup).toBe("done");
    expect(integration!.externalRef).toMatch(/^acct_/);
    expect(integration!.nextSyncAt!.getTime()).toBe(NOW.getTime() + 5 * 60_000);

    // Read only, pinned version, the creator's key as bearer.
    expect(stripe.calls.every((c) => c.method === "GET")).toBe(true);
    expect(stripe.calls.every((c) => c.headers["stripe-version"] === "2024-06-20" && c.headers.authorization?.startsWith("Bearer rk_live_"))).toBe(true);
    expect(stripe.calls.filter((c) => c.url.includes("/v1/charges")).length).toBeGreaterThanOrEqual(3);

    // A second run with nothing new changes nothing.
    await syncStripe(s.deps, s.integrationId);
    expect(await rowsOf(s.account.id)).toHaveLength(3);
  });

  it("gives a paying customer the same Contact as the commenter, and a second email of the same Stripe customer too", async () => {
    const state = { charges: [] as FakeCharge[] };
    const s = await setup(fakeStripe(state));
    const [channel] = await db().insert(channels).values({ accountId: s.account.id, youtubeChannelId: `UC${randomUUID()}`, status: "connected" }).returning();
    const [campaign] = await db().insert(campaigns).values({ accountId: s.account.id, channelId: channel!.id, name: "Guide", keyword: "guide", destinationUrl: "https://coach.com/optin" }).returning();
    const [link] = await db()
      .insert(links)
      .values({ accountId: s.account.id, kind: "static", slug: newTid().slice(0, 7), host: "go.vidrev.app", campaignId: campaign!.id, youtubeVideoId: "VID1", keyword: "guide", destinationUrl: "https://coach.com/optin" })
      .returning();
    const tid = newTid();
    await db().insert(clicks).values({ tid, accountId: s.account.id, linkId: link!.id, campaignId: campaign!.id, youtubeVideoId: "VID1", keyword: "guide", host: "go.vidrev.app", userAgentClass: "desktop", isBot: false, createdAt: new Date(NOW.getTime() - 3 * DAY) });
    await recordOptIn(db(), s.account.id, { email: "lead@example.com", name: null, tid, externalId: null, consentMarketing: null, occurredAt: new Date(NOW.getTime() - 3 * DAY) }, { source: "webhook", emit: async () => {} });

    state.charges.push(
      { id: "ch_1", amount: 9700, created: unix(2 * DAY), customer: { id: "cus_lead", email: "lead@example.com" } },
      // Same Stripe customer, a different card email.
      { id: "ch_2", amount: 9700, created: unix(1 * DAY), customer: { id: "cus_lead", email: "billing@company.com" } },
    );
    await syncStripe(s.deps, s.integrationId);

    expect(await live(s.account.id)).toHaveLength(1);
    const rows = await rowsOf(s.account.id);
    expect(new Set(rows.map((r) => r.contactId)).size).toBe(1);
    const identities = await db().select().from(contactIdentities).where(eq(contactIdentities.contactId, rows[0]!.contactId!));
    expect(identities.map((i) => i.kind).sort()).toEqual(["email", "email", "stripe_customer"]);

    await runAttribution(db(), s.account.id, NOW);
    const after = await rowsOf(s.account.id);
    expect(after.every((r) => r.attributedKeyword === "guide" && r.attributedVideoId === "VID1")).toBe(true);
  });

  it("counts a sale once when Stripe and a webhook both report it, Stripe being canonical", async () => {
    const state = { charges: [{ id: "ch_dup", amount: 9700, created: unix(2 * HOUR), customer: { id: "cus_d", email: "dup@example.com" } }] as FakeCharge[] };
    const s = await setup(fakeStripe(state));
    await recordPurchase(
      db(),
      s.account.id,
      { email: "dup@example.com", tid: null, externalId: "hook-1", amountCents: 9700, currency: "USD", refundedCents: null, subscriptionId: null, occurredAt: new Date(NOW.getTime() - 2 * HOUR + 60_000) },
      { source: "webhook", emit: async () => {} },
    );
    await syncStripe(s.deps, s.integrationId);
    await runAttribution(db(), s.account.id, NOW);
    const rows = await rowsOf(s.account.id);
    const stripeRow = rows.find((r) => r.source === "stripe")!;
    const hookRow = rows.find((r) => r.source === "webhook")!;
    expect(stripeRow.canonicalPurchaseId).toBe(stripeRow.id);
    expect(hookRow.canonicalPurchaseId).toBe(stripeRow.id);
    expect(stripeRow.netCents).toBe(9700);
    expect(hookRow.netCents).toBe(0);
  });

  it("records a refund on the same purchase without a new row", async () => {
    const state = { charges: [{ id: "ch_ref", amount: 5000, created: unix(3 * HOUR), customer: { id: "cus_r", email: "ref@example.com" } }] as FakeCharge[] };
    const s = await setup(fakeStripe(state));
    await syncStripe(s.deps, s.integrationId);
    state.charges[0]!.amount_refunded = 2000;
    await syncStripe(s.deps, s.integrationId);
    const rows = await rowsOf(s.account.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ amountCents: 5000, refundedCents: 2000 });
  });

  it("imports old sales quietly and announces only fresh ones to the creator's endpoints", async () => {
    const state = {
      charges: [
        { id: "ch_old", amount: 1000, created: unix(30 * DAY), customer: { id: "cus_o", email: "old@example.com" } },
        { id: "ch_new", amount: 2000, created: unix(2 * HOUR), customer: { id: "cus_n", email: "new@example.com" } },
      ] as FakeCharge[],
    };
    const s = await setup(fakeStripe(state));
    const endpoint = await createEndpoint(db(), key, { accountId: s.account.id, url: "https://hooks.example.com/x" });
    if (!endpoint.ok) throw new Error(endpoint.error);
    await syncStripe(s.deps, s.integrationId);

    const rows = await rowsOf(s.account.id);
    expect(rows).toHaveLength(2);
    const deliveries = await db().select().from(outboundDeliveries).where(eq(outboundDeliveries.accountId, s.account.id));
    const purchaseEvents = deliveries.filter((d) => d.event === "purchase");
    expect(purchaseEvents).toHaveLength(1);
    expect(purchaseEvents[0]!.payload).toMatchObject({ event: "purchase", source: "stripe", amount_cents: 2000, currency: "USD" });
  });

  it("marks the connection as needing a new key once when Stripe refuses it, and stops syncing", async () => {
    const stripe = fakeStripe({ charges: [], status: 401 });
    const s = await setup(stripe);
    await syncStripe(s.deps, s.integrationId);
    const [row] = await db().select().from(integrations).where(eq(integrations.id, s.integrationId));
    expect(row).toMatchObject({ status: "error", statusReason: "key_rejected" });
    expect(row!.lastError).toContain("Stripe refused the key");
    expect(s.rejected).toEqual([s.account.id]);
    // Not active any more: another run does nothing and does not mail again.
    await syncStripe(s.deps, s.integrationId);
    expect(s.rejected).toHaveLength(1);
    // A new key reactivates it.
    const again = await connectStripe(db(), key, s.account.id, restrictedKey(), NOW);
    expect(again).toMatchObject({ ok: true, id: s.integrationId });
    const [reactivated] = await db().select().from(integrations).where(eq(integrations.id, s.integrationId));
    expect(reactivated).toMatchObject({ status: "active", statusReason: null });
  });

  it("keeps one Stripe account in one vidrev account", async () => {
    const shared = `acct_${randomUUID()}`;
    const a = await setup(fakeStripe({ charges: [], accountId: shared }));
    await syncStripe(a.deps, a.integrationId);
    const other = fakeStripe({ charges: [], accountId: shared });
    const b = await setup(other);
    b.deps.fetch = other.fetchImpl;
    await syncStripe(b.deps, b.integrationId);
    const [row] = await db().select().from(integrations).where(eq(integrations.id, b.integrationId));
    expect(row).toMatchObject({ status: "error", statusReason: "account_taken" });
  });

  it("queues each due sync once", async () => {
    const s = await setup(fakeStripe({ charges: [] }));
    await queueStripeWork(s.deps);
    await queueStripeWork(s.deps);
    expect(s.queued.filter((q) => (q.data as { integrationId: string }).integrationId === s.integrationId)).toHaveLength(1);
  });

  it("refuses unsafe keys, stores the key encrypted and wipes it on disconnect", async () => {
    const { account } = await createAccountWithUser(db(), { email: `st-${randomUUID()}@example.com`, planCode: "standard_monthly" });
    expect(await connectStripe(db(), key, account.id, "sk_live_abcdefghijklmnopqrstuvwxyz")).toMatchObject({ ok: false });
    expect(await connectStripe(db(), key, account.id, "rk_test_abcdefghijklmnopqrstuvwxyz")).toMatchObject({ ok: false });
    expect(await db().select().from(integrations).where(and(eq(integrations.accountId, account.id), eq(integrations.type, "stripe")))).toHaveLength(0);

    const apiKey = restrictedKey();
    const ok = await connectStripe(db(), key, account.id, apiKey, NOW);
    if (!ok.ok) throw new Error(ok.error);
    const [row] = await db().select().from(integrations).where(eq(integrations.id, ok.id));
    expect(row!.configEnc).not.toContain(apiKey);
    expect(readStripeConfig(row!.configEnc!, key)).toMatchObject({ apiKey, last4: apiKey.slice(-4) });

    expect(await disconnectStripe(db(), account.id, ok.id, NOW)).toBe(true);
    const [gone] = await db().select().from(integrations).where(eq(integrations.id, ok.id));
    expect(gone).toMatchObject({ status: "removed", configEnc: null });
    expect(await disconnectStripe(db(), account.id, ok.id, NOW)).toBe(false);
  });
});
