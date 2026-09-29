import { generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Set before anything reads the environment (it is parsed lazily and cached).
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
process.env.GHL_WEBHOOK_PUBLIC_KEY = publicKey.export({ type: "spki", format: "pem" }).toString();

import { POST as ghlWebhook } from "@/app/api/hooks/crm/route";
import { closeDb, getDb } from "@/db/client";
import { campaigns, channels, clicks, integrations, links, outboundDeliveries, purchases, subscribers } from "@/db/schema";
import { newTid } from "@/lib/links";
import { runMigrations } from "@/scripts/migrate";
import { createAccountWithUser } from "@/server/accounts";
import { GhlApiError, type GhlContact, type GhlOpportunity, type GhlTransaction } from "@/server/ghl/api";
import { connectGhl, disconnectGhl } from "@/server/ghl/connect";
import { freshConfig, type GhlDeps, GhlReauthError, readGhlConfig, updateGhlConfig, withGhlApi } from "@/server/ghl/tokens";
import { emitEvent } from "@/server/integrations/events";
import { recordOptIn } from "@/server/integrations/inbound";
import { deliver } from "./webhooks";
import { handleGhlEvent, type GhlWorkerDeps, queueGhlWork, setupGhl, syncGhl } from "./ghl";

const hasDb = Boolean(process.env.DATABASE_URL);
const key = randomBytes(32).toString("base64");
const VIDEO = "dQw4w9WgXcQ";
const db = () => getDb();

interface Fake {
  tokenCalls: number;
  tokenMode: "ok" | "revoked";
  fields: { id: string; name: string; fieldKey: string }[];
  createdFields: number;
  contacts: GhlContact[];
  contactById: Record<string, GhlContact>;
  opps: GhlOpportunity[];
  oppCalls: number;
  txs: GhlTransaction[];
  upserts: { email: string; customFields?: { id: string; value: string }[] }[];
  tags: { contactId: string; tags: string[] }[];
  removed: { contactId: string; tags: string[] }[];
}

function newFake(): Fake {
  return { tokenCalls: 0, tokenMode: "ok", fields: [], createdFields: 0, contacts: [], contactById: {}, opps: [], oppCalls: 0, txs: [], upserts: [], tags: [], removed: [] };
}

function fakeFetch(state: Fake) {
  return async (input: string, init?: RequestInit): Promise<Response> => {
    const url = new URL(input);
    const path = url.pathname;
    const method = init?.method ?? "GET";
    const body = init?.body ? (typeof init.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : Object.fromEntries(new URLSearchParams(String(init.body)))) : {};
    if (path === "/oauth/token") {
      state.tokenCalls += 1;
      if (state.tokenMode === "revoked") return Response.json({ error: "invalid_grant" }, { status: 400 });
      return Response.json({ access_token: `access-${state.tokenCalls}`, refresh_token: `refresh-${state.tokenCalls}`, expires_in: 86_399 });
    }
    if (path === "/locations/L-1" && method === "GET") return Response.json({ location: { name: "Acme Coaching", website: "https://acme.com" } });
    if (path === "/locations/L-1/customFields" && method === "GET") return Response.json({ customFields: state.fields });
    if (path === "/locations/L-1/customFields" && method === "POST") {
      state.createdFields += 1;
      const field = { id: "F1", name: body.name, fieldKey: `contact.${body.name}` };
      state.fields.push(field);
      return Response.json({ customField: field });
    }
    if (path === "/contacts/" && method === "GET") return Response.json({ contacts: state.contacts, meta: {} });
    if (path === "/contacts/upsert") {
      state.upserts.push({ email: body.email, customFields: body.customFields });
      return Response.json({ contact: { id: `C-${state.upserts.length}` } });
    }
    const tagMatch = /^\/contacts\/([^/]+)\/tags$/.exec(path);
    if (tagMatch) {
      (method === "DELETE" ? state.removed : state.tags).push({ contactId: tagMatch[1]!, tags: body.tags });
      return Response.json({ tags: body.tags });
    }
    const contactMatch = /^\/contacts\/([^/]+)$/.exec(path);
    if (contactMatch) {
      const contact = state.contactById[contactMatch[1]!];
      return contact ? Response.json({ contact }) : new Response("{}", { status: 404 });
    }
    if (path === "/opportunities/search") {
      state.oppCalls += 1;
      return Response.json({ opportunities: state.opps, meta: {} });
    }
    if (path === "/payments/transactions") return Response.json({ data: url.searchParams.get("offset") === "0" ? state.txs : [], totalCount: state.txs.length });
    return new Response("not found", { status: 404 });
  };
}

interface Rig {
  deps: GhlWorkerDeps;
  fake: Fake;
  sent: { queue: string; data: unknown }[];
  reauth: string[];
  accountId: string;
  integrationId: string;
  campaignId: string;
  tid: string;
}

const nowFor = () => new Date();

async function rig(options: { setup?: boolean } = {}): Promise<Rig> {
  const { account } = await createAccountWithUser(db(), { email: `ghl-${randomUUID()}@example.com`, planCode: "standard_monthly" });
  const [channel] = await db().insert(channels).values({ accountId: account.id, youtubeChannelId: `UC${randomUUID()}`, status: "connected" }).returning();
  const [campaign] = await db()
    .insert(campaigns)
    .values({ accountId: account.id, channelId: channel!.id, name: "Guide", keyword: "guide", destinationUrl: "https://coach.com/optin" })
    .returning();
  const [link] = await db()
    .insert(links)
    .values({ accountId: account.id, kind: "static", slug: newTid().slice(0, 7), host: "go.vidrev.app", campaignId: campaign!.id, youtubeVideoId: VIDEO, keyword: "guide", destinationUrl: "https://coach.com/optin" })
    .returning();
  const tid = newTid();
  await db().insert(clicks).values({ tid, accountId: account.id, linkId: link!.id, campaignId: campaign!.id, youtubeVideoId: VIDEO, keyword: "guide", host: "go.vidrev.app", userAgentClass: "desktop", isBot: false });

  const connected = await connectGhl(db(), key, account.id, { access_token: "access-0", refresh_token: "refresh-0", expires_in: 86_399, userType: "Location", locationId: "L-1" }, nowFor());
  if (!connected.ok) throw new Error(connected.error);
  // One location is live in one account at most: tests use a unique location per rig.
  const location = `L-1`;
  await db().update(integrations).set({ externalRef: `${location}-${randomUUID()}` }).where(eq(integrations.id, connected.id));

  const fake = newFake();
  const sent: Rig["sent"] = [];
  const reauth: string[] = [];
  const deps: GhlWorkerDeps = {
    db: db(),
    fetch: fakeFetch(fake),
    encryptionKey: key,
    client: { clientId: "c", clientSecret: "s" },
    enqueue: async (queue, data) => {
      sent.push({ queue, data });
    },
    onReauth: async (id) => {
      reauth.push(id);
    },
  };
  const result: Rig = { deps, fake, sent, reauth, accountId: account.id, integrationId: connected.id, campaignId: campaign!.id, tid };
  if (options.setup) await setupGhl(deps, connected.id);
  return result;
}

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

describe.skipIf(!hasDb)("GoHighLevel connector (integration)", () => {
  beforeAll(async () => {
    await runMigrations(process.env.DATABASE_URL!);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("connects one location per account, keeps choices on reconnect and never stores tokens in the clear", async () => {
    const a = await createAccountWithUser(db(), { email: `c-${randomUUID()}@example.com`, planCode: "standard_monthly" });
    const b = await createAccountWithUser(db(), { email: `c-${randomUUID()}@example.com`, planCode: "standard_monthly" });
    const location = `LOC-${randomUUID()}`;
    const tokens = { access_token: "SECRET-ACCESS", refresh_token: "SECRET-REFRESH", expires_in: 86_399, userType: "Location", locationId: location };

    expect(await connectGhl(db(), key, a.account.id, { ...tokens, userType: "Company" })).toEqual({ ok: false, error: "not_location" });
    const first = await connectGhl(db(), key, a.account.id, tokens);
    if (!first.ok) throw new Error("connect failed");
    const [row] = await db().select().from(integrations).where(eq(integrations.id, first.id));
    expect(row).toMatchObject({ type: "ghl", externalRef: location, status: "active", events: ["opt_in", "purchase"] });
    expect(row!.configEnc).not.toContain("SECRET");
    expect(readGhlConfig(row!.configEnc!, key)).toMatchObject({ accessToken: "SECRET-ACCESS", buyerTag: "vidrev-buyer" });

    expect(await connectGhl(db(), key, b.account.id, tokens)).toEqual({ ok: false, error: "location_taken" });
    expect(await connectGhl(db(), key, a.account.id, { ...tokens, locationId: `LOC-${randomUUID()}` })).toEqual({ ok: false, error: "already_connected" });

    const deps: GhlDeps = { db: db(), fetch, encryptionKey: key, client: null };
    await updateGhlConfig(deps, first.id, { customFieldId: "F9", buyerTag: "customer", locationName: "Acme" });
    const again = await connectGhl(db(), key, a.account.id, { ...tokens, access_token: "NEW-ACCESS" });
    expect(again).toEqual({ ok: true, id: first.id });
    const [reconnected] = await db().select().from(integrations).where(eq(integrations.id, first.id));
    expect(readGhlConfig(reconnected!.configEnc!, key)).toMatchObject({ accessToken: "NEW-ACCESS", customFieldId: "F9", buyerTag: "customer", locationName: "Acme" });

    expect(await disconnectGhl(db(), b.account.id, first.id)).toBe(false);
    expect(await disconnectGhl(db(), a.account.id, first.id)).toBe(true);
    const [gone] = await db().select().from(integrations).where(eq(integrations.id, first.id));
    expect(gone).toMatchObject({ status: "removed", configEnc: null });
    // The location is free again.
    expect(await connectGhl(db(), key, b.account.id, tokens)).toMatchObject({ ok: true });
  });

  it("sets up the tracking field once, or reuses the creator's own", async () => {
    const r = await rig();
    await setupGhl(r.deps, r.integrationId);
    await setupGhl(r.deps, r.integrationId);
    expect(r.fake.createdFields).toBe(1);
    const [row] = await db().select().from(integrations).where(eq(integrations.id, r.integrationId));
    expect(row).toMatchObject({ label: "GoHighLevel: Acme Coaching", syncState: { setup: "done" } });
    expect(readGhlConfig(row!.configEnc!, key)).toMatchObject({ customFieldId: "F1", locationName: "Acme Coaching", locationWebsite: "https://acme.com" });

    const other = await rig();
    other.fake.fields.push({ id: "MINE", name: "vidrev tracking id", fieldKey: "contact.vidrev_tracking_id" });
    await setupGhl(other.deps, other.integrationId);
    expect(other.fake.createdFields).toBe(0);
    const [reused] = await db().select().from(integrations).where(eq(integrations.id, other.integrationId));
    expect(readGhlConfig(reused!.configEnc!, key).customFieldId).toBe("MINE");
  });

  it("moves an older integration from the c2c_tid field to the vidrev tracking id field once", async () => {
    const r = await rig({ setup: true });
    await updateGhlConfig(r.deps, r.integrationId, { customFieldId: "OLD-C2C" });
    await db().update(integrations).set({ syncState: { setup: "done" } }).where(eq(integrations.id, r.integrationId));
    await syncGhl(r.deps, r.integrationId);
    const [row] = await db().select().from(integrations).where(eq(integrations.id, r.integrationId));
    expect(readGhlConfig(row!.configEnc!, key).customFieldId).toBe("F1");
    expect(row!.syncState).toMatchObject({ trackingField: "vidrev" });
    await syncGhl(r.deps, r.integrationId);
    expect(r.fake.createdFields).toBe(1);
  });

  it("refreshes the rotating token once under parallel use, and asks for a reconnect when refused", async () => {
    const r = await rig({ setup: true });
    const deps = { ...r.deps };
    await updateGhlConfig(deps, r.integrationId, { expiresAt: new Date(Date.now() - 60_000).toISOString() });
    const [x, y] = await Promise.all([freshConfig(deps, r.integrationId), freshConfig(deps, r.integrationId)]);
    expect(r.fake.tokenCalls).toBe(1);
    expect(x.accessToken).toBe("access-1");
    expect(y.refreshToken).toBe("refresh-1");
    const [row] = await db().select().from(integrations).where(eq(integrations.id, r.integrationId));
    expect(readGhlConfig(row!.configEnc!, key)).toMatchObject({ accessToken: "access-1", refreshToken: "refresh-1" });

    r.fake.tokenMode = "revoked";
    await updateGhlConfig(deps, r.integrationId, { expiresAt: new Date(Date.now() - 60_000).toISOString() });
    await expect(withGhlApi(deps, r.integrationId, async () => "never")).rejects.toBeInstanceOf(GhlReauthError);
    const [failed] = await db().select().from(integrations).where(eq(integrations.id, r.integrationId));
    expect(failed).toMatchObject({ status: "error", statusReason: "reauthorize" });
    expect(r.reauth).toEqual([r.accountId]);
    await expect(freshConfig(deps, r.integrationId)).rejects.toBeInstanceOf(GhlReauthError);
    expect(r.reauth).toHaveLength(1);
  });

  it("a 401 for a missing scope neither refreshes the token nor asks for a reconnect", async () => {
    const r = await rig({ setup: true });
    const before = r.fake.tokenCalls;
    const denied = new GhlApiError(401, JSON.stringify({ statusCode: 401, message: "The token is not authorized for this scope." }), "funnels/redirect/list");
    await expect(
      withGhlApi(r.deps, r.integrationId, async () => {
        throw denied;
      }),
    ).rejects.toBe(denied);
    expect(r.fake.tokenCalls).toBe(before);
    const [row] = await db().select().from(integrations).where(eq(integrations.id, r.integrationId));
    expect(row!.status).toBe("active");
    expect(r.reauth).toEqual([]);
  });

  it("syncs contacts, buyer tags, won opportunities and payments, and is idempotent", async () => {
    const r = await rig({ setup: true });
    const since = ago(3_600_000);
    r.fake.contacts = [
      { id: "c1", email: "Lead@X.com", firstName: "Lea", lastName: "Kim", customFields: [{ id: "F1", value: r.tid }], dateAdded: since },
      { id: "c2", email: "buyer@x.com", tags: ["Other", "Vidrev-Buyer"], dateAdded: since },
      { id: "c3", email: null, dateAdded: since },
      { id: "c4", email: "old@x.com", customFields: [{ id: "F1", value: r.tid }], dateAdded: ago(30 * 86_400_000) },
    ];
    r.fake.contactById = { cw2: { id: "cw2", email: "won2@x.com" }, cp3: { id: "cp3", email: "pay3@x.com" } };
    r.fake.opps = [
      { id: "O1", status: "won", contact: { id: "cw1", email: "Won@X.com" } },
      { id: "O2", status: "won", contactId: "cw2" },
    ];
    r.fake.txs = [
      { _id: "T1", amount: 97, currency: "usd", status: "succeeded", contactEmail: "pay@x.com", subscriptionId: "S1", createdAt: since },
      { _id: "T2", amount: 50, currency: "USD", status: "failed", contactEmail: "fail@x.com", createdAt: since },
      { _id: "T3", amount: 19.99, currency: "USD", status: "succeeded", contactId: "cp3", createdAt: since },
      { _id: "T4", amount: 100, currency: "USD", status: "partially_refunded", contactEmail: "part@x.com", refunds: [{ amount: 30 }], createdAt: since },
      { _id: "T5", amount: 0, currency: "USD", status: "succeeded", contactEmail: "free@x.com", createdAt: since },
    ];

    await syncGhl(r.deps, r.integrationId);

    const subs = await db().select().from(subscribers).where(eq(subscribers.accountId, r.accountId));
    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({ emailNorm: "lead@x.com", name: "Lea Kim", source: "ghl", tid: r.tid, campaignId: r.campaignId, keyword: "guide", ghlContactId: "c1" });

    const rows = await db().select().from(purchases).where(eq(purchases.accountId, r.accountId));
    const by = (email: string) => rows.find((p) => p.emailNorm === email);
    expect(rows).toHaveLength(6);
    expect(by("buyer@x.com")).toMatchObject({ source: "ghl", kind: "buyer_marker", amountCents: null, externalId: "tag:c2" });
    expect(by("won@x.com")).toMatchObject({ kind: "buyer_marker", externalId: "opp:O1" });
    expect(by("won2@x.com")).toMatchObject({ kind: "buyer_marker", externalId: "opp:O2", ghlContactId: "cw2" });
    expect(by("pay@x.com")).toMatchObject({ kind: "payment", amountCents: 9700, currency: "USD", subscriptionRef: "S1", externalId: "T1" });
    expect(by("pay3@x.com")).toMatchObject({ amountCents: 1999 });
    expect(by("part@x.com")).toMatchObject({ amountCents: 10_000, refundedCents: 3000 });
    expect(by("fail@x.com")).toBeUndefined();
    expect(by("free@x.com")).toBeUndefined();

    const [state] = await db().select().from(integrations).where(eq(integrations.id, r.integrationId));
    expect(state).toMatchObject({ lastError: null });
    expect(state!.lastSuccessAt).not.toBeNull();
    expect(state!.syncState).toMatchObject({ setup: "done" });
    expect(Object.keys(state!.syncState)).toEqual(expect.arrayContaining(["contactsCursor", "oppAt", "txCursor", "deepAt"]));
    expect(state!.nextSyncAt!.getTime()).toBeGreaterThan(Date.now() + 4 * 60_000);

    // Second run: nothing new, opportunities not read again within the hour, a refund is picked up.
    r.fake.txs[3] = { ...r.fake.txs[3]!, status: "refunded", refunds: [] };
    await syncGhl(r.deps, r.integrationId);
    expect(await db().select().from(subscribers).where(eq(subscribers.accountId, r.accountId))).toHaveLength(1);
    const after = await db().select().from(purchases).where(eq(purchases.accountId, r.accountId));
    expect(after).toHaveLength(6);
    expect(after.find((p) => p.externalId === "T4")).toMatchObject({ refundedCents: 10_000 });
    expect(r.fake.oppCalls).toBe(1);
  });

  it("a buyer tag or won opportunity adds no second buyer row once a real payment exists", async () => {
    const r = await rig({ setup: true });
    r.fake.txs = [{ _id: "P1", amount: 10, currency: "USD", status: "succeeded", contactEmail: "dup@x.com", createdAt: ago(1000) }];
    r.fake.contacts = [{ id: "cd", email: "dup@x.com", tags: ["vidrev-buyer"], dateAdded: ago(1000) }];
    r.fake.opps = [{ id: "OD", status: "won", contact: { email: "dup@x.com" } }];
    // Payments come last in a run, so a marker may land first; a second run must not add more buyers than emails.
    await syncGhl(r.deps, r.integrationId);
    await syncGhl(r.deps, r.integrationId);
    const rows = await db().select().from(purchases).where(eq(purchases.accountId, r.accountId));
    expect(rows.filter((p) => p.kind === "payment")).toHaveLength(1);
    expect(new Set(rows.map((p) => p.emailNorm)).size).toBe(1);
  });

  it("handles marketplace webhook events through the API", async () => {
    const r = await rig({ setup: true });
    r.fake.contactById = { cx: { id: "cx", email: "tagged@x.com", tags: ["vidrev-buyer"], dateAdded: ago(1000) }, cy: { id: "cy", email: "won3@x.com" } };
    await handleGhlEvent(r.deps, r.integrationId, { type: "ContactTagUpdate", locationId: "L-1", id: "cx" });
    await handleGhlEvent(r.deps, r.integrationId, { type: "OpportunityStatusUpdate", id: "O9", status: "won", contactId: "cy" });
    await handleGhlEvent(r.deps, r.integrationId, { type: "OpportunityStatusUpdate", id: "O10", status: "open", contactId: "cy" });
    await handleGhlEvent(r.deps, r.integrationId, { type: "SomethingElse" });
    const rows = await db().select().from(purchases).where(eq(purchases.accountId, r.accountId));
    expect(rows.map((p) => p.externalId).sort()).toEqual(["opp:O9", "tag:cx"]);
  });

  it("tags attributed subscribers and buyers in GoHighLevel through the outbox, and leaves strangers alone", async () => {
    const r = await rig({ setup: true });
    const emit = async (input: Parameters<typeof emitEvent>[1]) => void (await emitEvent(db(), input));
    const attributed = await recordOptIn(db(), r.accountId, { email: "lead@x.com", name: null, tid: r.tid, externalId: null, consentMarketing: null, occurredAt: new Date() }, { source: "webhook", emit });
    const stranger = await recordOptIn(db(), r.accountId, { email: "nobody@x.com", name: null, tid: null, externalId: null, consentMarketing: null, occurredAt: new Date() }, { source: "webhook", emit });

    const at = new Date(Date.now() + 1000);
    const hooks = { db: db(), encryptionKey: key, post: async () => ({ status: 200 }), ghl: r.deps, now: () => at };
    const rows = await db().select().from(outboundDeliveries).where(eq(outboundDeliveries.accountId, r.accountId));
    expect(rows).toHaveLength(2);
    for (const row of rows) await deliver(hooks, row.id);

    expect(r.fake.upserts).toEqual([{ email: "lead@x.com", customFields: [{ id: "F1", value: r.tid }] }]);
    expect(r.fake.tags).toEqual([
      { contactId: "C-1", tags: ["vidrev", "vidrev-source-youtube", "vidrev-keyword-guide", "vidrev-temperature-warm-lead", `vidrev-video-${VIDEO}`] },
    ]);
    // One temperature per person: the other two are removed.
    expect(r.fake.removed).toEqual([{ contactId: "C-1", tags: ["vidrev-temperature-cold-lead", "vidrev-temperature-hot-lead"] }]);
    const done = await db().select().from(outboundDeliveries).where(eq(outboundDeliveries.accountId, r.accountId));
    expect(done.find((d) => d.eventId === attributed.id)).toMatchObject({ status: "delivered", lastError: null });
    expect(done.find((d) => d.eventId === stranger.id)).toMatchObject({ status: "delivered", lastError: "not_attributed" });
  });

  it("retries a failed GoHighLevel delivery, and drops it once the connection needs a reconnect", async () => {
    const r = await rig({ setup: true });
    const emit = async (input: Parameters<typeof emitEvent>[1]) => void (await emitEvent(db(), input));
    await recordOptIn(db(), r.accountId, { email: "lead@x.com", name: null, tid: r.tid, externalId: null, consentMarketing: null, occurredAt: new Date() }, { source: "webhook", emit });
    const [row] = await db().select().from(outboundDeliveries).where(eq(outboundDeliveries.accountId, r.accountId));

    const failing: GhlWorkerDeps = { ...r.deps, fetch: async (input, init) => (new URL(input).pathname === "/contacts/upsert" ? new Response("busy", { status: 503 }) : fakeFetch(r.fake)(input, init)) };
    const t1 = new Date(Date.now() + 1000);
    await deliver({ db: db(), encryptionKey: key, post: async () => ({ status: 200 }), ghl: failing, now: () => t1 }, row!.id);
    expect(await db().select().from(outboundDeliveries).where(eq(outboundDeliveries.id, row!.id))).toMatchObject([{ status: "pending", attempt: 1, lastError: "ghl_http_503" }]);

    await db().update(integrations).set({ status: "error", statusReason: "reauthorize" }).where(eq(integrations.id, r.integrationId));
    const t2 = new Date(t1.getTime() + 61_000);
    await deliver({ db: db(), encryptionKey: key, post: async () => ({ status: 200 }), ghl: r.deps, now: () => t2 }, row!.id);
    expect(await db().select().from(outboundDeliveries).where(eq(outboundDeliveries.id, row!.id))).toMatchObject([{ status: "dead", lastError: "endpoint_not_active" }]);
  });

  it("queues setup and sync work once per due integration", async () => {
    const r = await rig();
    // Other tests leave integrations in the same database; look at this one only.
    const mine = (queue: string) => r.sent.filter((s) => s.queue === queue && (s.data as { integrationId: string }).integrationId === r.integrationId);
    await queueGhlWork(r.deps);
    await queueGhlWork(r.deps);
    expect(mine("ghl.setup")).toHaveLength(1);
    await setupGhl(r.deps, r.integrationId);
    await queueGhlWork(r.deps);
    expect(mine("ghl.sync")).toHaveLength(1);
    await queueGhlWork(r.deps);
    expect(mine("ghl.sync")).toHaveLength(1);
  });

  describe("marketplace webhook route", () => {
    async function post(body: unknown, signWith: string | null | "valid" = "valid") {
      const raw = JSON.stringify(body);
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (signWith === "valid") headers["x-ghl-signature"] = sign(null, Buffer.from(raw), privateKey).toString("base64");
      else if (signWith) headers["x-ghl-signature"] = signWith;
      return ghlWebhook(new Request("https://app.vidrev.app/api/hooks/crm", { method: "POST", headers, body: raw }));
    }

    it("verifies the Ed25519 signature, ignores unknown locations and drops our side on uninstall", async () => {
      const r = await rig({ setup: true });
      const [row] = await db().select().from(integrations).where(eq(integrations.id, r.integrationId));
      const location = row!.externalRef!;

      expect((await post({ type: "ContactCreate", locationId: location }, null)).status).toBe(401);
      expect((await post({ type: "ContactCreate", locationId: location }, "AAAA")).status).toBe(401);
      expect(await (await post({ type: "ContactCreate", locationId: "nowhere" })).json()).toEqual({ ok: true, ignored: "unknown_location" });
      expect(await (await post({ type: "ContactCreate" })).json()).toEqual({ ok: true, ignored: "no_location" });

      expect((await post({ type: "UNINSTALL", locationId: location })).status).toBe(200);
      const [gone] = await db().select().from(integrations).where(eq(integrations.id, r.integrationId));
      expect(gone).toMatchObject({ status: "removed", configEnc: null, statusReason: "uninstalled" });
    });
  });
});
