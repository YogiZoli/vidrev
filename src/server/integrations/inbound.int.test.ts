import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/db/client";
import { accounts, campaigns, channels, clicks, links, outboundDeliveries, purchases, subscribers } from "@/db/schema";
import { hmacSha256Hex } from "@/lib/crypto";
import { newTid } from "@/lib/links";
import { runMigrations } from "@/scripts/migrate";
import { createAccountWithUser } from "@/server/accounts";
import { emitEvent, type EmitInput } from "./events";
import { accountForToken, ensureHookToken, recordOptIn, recordPurchase, rotateHookToken } from "./inbound";
import { handleInbound } from "./inbound-http";
import { createEndpoint } from "./outbound";

const hasDb = Boolean(process.env.DATABASE_URL);
const key = randomBytes(32).toString("base64");
const db = () => getDb();
const VIDEO = "dQw4w9WgXcQ";

async function setup() {
  const { account } = await createAccountWithUser(db(), { email: `in-${randomUUID()}@example.com`, planCode: "standard_monthly" });
  const [channel] = await db().insert(channels).values({ accountId: account.id, youtubeChannelId: `UC${randomUUID()}`, status: "connected" }).returning();
  const [campaign] = await db()
    .insert(campaigns)
    .values({ accountId: account.id, channelId: channel!.id, name: "Guide", keyword: "guide", intent: "hot", destinationUrl: "https://coach.com/optin" })
    .returning();
  const [link] = await db()
    .insert(links)
    .values({ accountId: account.id, kind: "static", slug: newTid().slice(0, 7), host: "go.vidrev.app", campaignId: campaign!.id, youtubeVideoId: VIDEO, keyword: "guide", intent: "hot", destinationUrl: "https://coach.com/optin" })
    .returning();
  const tid = newTid();
  const [click] = await db()
    .insert(clicks)
    .values({ tid, accountId: account.id, linkId: link!.id, campaignId: campaign!.id, youtubeVideoId: VIDEO, keyword: "guide", host: "go.vidrev.app", userAgentClass: "desktop", isBot: false })
    .returning();
  const token = await ensureHookToken(db(), key, account.id);
  return { account, channel: channel!, campaign: campaign!, link: link!, click: click!, tid, token };
}

function post(path: "optin" | "purchase", token: string | null, body: unknown, options: { form?: boolean; via?: "bearer" | "header" | "query"; signature?: string } = {}) {
  const raw = options.form ? new URLSearchParams(body as Record<string, string>).toString() : JSON.stringify(body);
  const headers: Record<string, string> = { "content-type": options.form ? "application/x-www-form-urlencoded" : "application/json" };
  let url = `https://app.vidrev.app/api/hooks/${path}`;
  if (token && (options.via ?? "bearer") === "bearer") headers.authorization = `Bearer ${token}`;
  if (token && options.via === "header") headers["x-hook-token"] = token;
  if (token && options.via === "query") url += `?token=${token}`;
  if (options.signature) headers["x-signature"] = options.signature;
  return handleInbound(new Request(url, { method: "POST", headers, body: raw }), path);
}

describe.skipIf(!hasDb)("inbound hooks (integration)", () => {
  beforeAll(async () => {
    await runMigrations(process.env.DATABASE_URL!);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("creates one token per account, keeps it, rotates it and only finds live tokens", async () => {
    const { account, token } = await setup();
    expect(token).toMatch(/^c2c_hk_/);
    expect(await ensureHookToken(db(), key, account.id)).toBe(token);
    expect(await accountForToken(db(), token)).toEqual({ accountId: account.id, active: true });
    const next = await rotateHookToken(db(), key, account.id);
    expect(next).not.toBe(token);
    expect(await accountForToken(db(), token)).toBeNull();
    expect(await accountForToken(db(), next)).toMatchObject({ accountId: account.id });
    expect(await accountForToken(db(), "nope")).toBeNull();
  });

  it("authorizes by bearer, header or query token, and checks an HMAC when one is sent", async () => {
    const { token } = await setup();
    const body = { email: `a-${randomUUID()}@example.com` };
    expect((await post("optin", null, body)).status).toBe(401);
    expect((await post("optin", "c2c_hk_wrong", body)).status).toBe(401);
    for (const via of ["bearer", "header", "query"] as const) {
      expect((await post("optin", token, { email: `${via}-${randomUUID()}@example.com` }, { via })).status).toBe(200);
    }
    const raw = JSON.stringify({ email: `sig-${randomUUID()}@example.com` });
    const good = await handleInbound(
      new Request("https://app.vidrev.app/api/hooks/optin", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-signature": `sha256=${hmacSha256Hex(raw, token)}` },
        body: raw,
      }),
      "optin",
    );
    expect(good.status).toBe(200);
    expect((await post("optin", token, { email: "x@y.com" }, { signature: "sha256=deadbeef" })).status).toBe(401);
  });

  it("records an attributed opt-in once, from JSON or a form post", async () => {
    const { account, campaign, click, tid, token } = await setup();
    const email = `Lead-${randomUUID()}@Example.com`;
    const first = await post("optin", token, { email, name: "Lea", c2c_tid: tid, marketing_consent: true });
    expect(await first.json()).toEqual({ ok: true, created: true, attributed: true });
    const second = await post("optin", token, { email: email.toLowerCase(), tid }, { form: true });
    expect(await second.json()).toEqual({ ok: true, created: false, attributed: true });

    const rows = await db().select().from(subscribers).where(eq(subscribers.accountId, account.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      emailNorm: email.toLowerCase(),
      name: "Lea",
      source: "webhook",
      tid,
      clickId: click.id,
      campaignId: campaign.id,
      youtubeVideoId: VIDEO,
      keyword: "guide",
      consentMarketing: true,
    });
  });

  it("keeps an unknown tid, and a tid from another account never attributes", async () => {
    const a = await setup();
    const b = await setup();
    const email = `x-${randomUUID()}@example.com`;
    const other = await post("optin", a.token, { email, tid: b.tid });
    expect(await other.json()).toMatchObject({ created: true, attributed: false });
    const unknown = await post("optin", a.token, { email: `u-${randomUUID()}@example.com`, tid: "Zzzzzzzzzz" });
    expect(await unknown.json()).toMatchObject({ created: true, attributed: false });
    const [row] = await db().select().from(subscribers).where(eq(subscribers.emailNorm, email));
    expect(row).toMatchObject({ tid: b.tid, clickId: null, campaignId: null, consentMarketing: null });
  });

  it("emits an opt_in event to the creator's endpoints with the attribution and tags", async () => {
    const { account, tid, campaign } = await setup();
    const created = await createEndpoint(db(), key, { accountId: account.id, url: "https://hooks.example.com/x" });
    if (!created.ok) throw new Error(created.error);
    const emitted: EmitInput[] = [];
    const emit = async (input: EmitInput) => {
      emitted.push(input);
      await emitEvent(db(), input);
    };
    const result = await recordOptIn(
      db(),
      account.id,
      { email: `e-${randomUUID()}@example.com`, name: null, tid, externalId: null, consentMarketing: null, occurredAt: new Date() },
      { source: "webhook", emit },
    );
    const [delivery] = await db().select().from(outboundDeliveries).where(eq(outboundDeliveries.eventId, result.id!));
    expect(delivery!.payload).toMatchObject({
      event: "opt_in",
      id: result.id,
      keyword: "guide",
      campaign: "Guide",
      campaign_id: campaign.id,
      video_id: VIDEO,
      source: "webhook",
      tags: ["c2c", "c2c_kw_guide", "c2c_vid_dQw4w9WgXcQ"],
    });
  });

  it("stores a purchase once, fills a refund later, and reports a buyer without an amount", async () => {
    const { account, token, tid } = await setup();
    const email = `buyer-${randomUUID()}@example.com`;
    await post("optin", token, { email, tid });
    const order = { email, external_id: "ord_1", amount: "97.00", currency: "USD", subscription_id: "sub_1" };
    expect(await (await post("purchase", token, order)).json()).toEqual({ ok: true, created: true, refund_updated: false });
    expect(await (await post("purchase", token, order)).json()).toEqual({ ok: true, created: false, refund_updated: false });
    expect(await (await post("purchase", token, { ...order, type: "refund", refunded_amount: "40" })).json()).toEqual({ ok: true, created: false, refund_updated: true });
    await post("purchase", token, { email, external_id: "marker_1" });

    const rows = await db().select().from(purchases).where(eq(purchases.accountId, account.id));
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.externalId === "ord_1")).toMatchObject({
      source: "webhook",
      kind: "payment",
      emailNorm: email,
      amountCents: 9700,
      currency: "USD",
      refundedCents: 4000,
      subscriptionRef: "sub_1",
    });
    expect(rows.find((r) => r.externalId === "marker_1")).toMatchObject({ kind: "buyer_marker", amountCents: null, currency: null });
  });

  it("enriches the purchase event from the latest touch within 180 days; unmatched buyers get no c2c_buyer tag", async () => {
    const { account, tid, campaign, link } = await setup();
    const created = await createEndpoint(db(), key, { accountId: account.id, url: "https://hooks.example.com/x" });
    if (!created.ok) throw new Error(created.error);
    const emit = async (input: EmitInput) => void (await emitEvent(db(), input));
    const email = `t-${randomUUID()}@example.com`;
    await recordOptIn(db(), account.id, { email, name: null, tid, externalId: null, consentMarketing: null, occurredAt: new Date(Date.now() - 10 * 86_400_000) }, { source: "webhook", emit });

    const matched = await recordPurchase(
      db(),
      account.id,
      { email, tid: null, externalId: "p1", amountCents: 9700, currency: "USD", refundedCents: null, subscriptionId: null, occurredAt: new Date() },
      { source: "webhook", emit },
    );
    const stranger = await recordPurchase(
      db(),
      account.id,
      { email: `s-${randomUUID()}@example.com`, tid: null, externalId: "p2", amountCents: 500, currency: "USD", refundedCents: null, subscriptionId: null, occurredAt: new Date() },
      { source: "webhook", emit },
    );
    const [m] = await db().select().from(outboundDeliveries).where(eq(outboundDeliveries.eventId, matched.id));
    expect(m!.payload).toMatchObject({ event: "purchase", campaign_id: campaign.id, keyword: "guide", amount_cents: 9700, currency: "USD", tags: ["c2c", "c2c_kw_guide", "c2c_vid_dQw4w9WgXcQ", "c2c_buyer"] });
    const [s] = await db().select().from(outboundDeliveries).where(eq(outboundDeliveries.eventId, stranger.id));
    expect(s!.payload).toMatchObject({ keyword: null, tags: ["c2c"] });

    // A touch older than 180 days no longer counts.
    // (Its own click: one tracking id with two emails would be one person, DECISIONS Q-23.)
    const oldTid = newTid();
    await db()
      .insert(clicks)
      .values({ tid: oldTid, accountId: account.id, linkId: link.id, campaignId: campaign.id, youtubeVideoId: VIDEO, keyword: "guide", host: "go.vidrev.app", userAgentClass: "desktop", isBot: false });
    const old = `o-${randomUUID()}@example.com`;
    await recordOptIn(db(), account.id, { email: old, name: null, tid: oldTid, externalId: "old-1", consentMarketing: null, occurredAt: new Date(Date.now() - 200 * 86_400_000) }, { source: "webhook", emit });
    const late = await recordPurchase(
      db(),
      account.id,
      { email: old, tid: null, externalId: "p3", amountCents: 100, currency: "USD", refundedCents: null, subscriptionId: null, occurredAt: new Date() },
      { source: "webhook", emit },
    );
    const [l] = await db().select().from(outboundDeliveries).where(eq(outboundDeliveries.eventId, late.id));
    expect(l!.payload).toMatchObject({ keyword: null });
  });

  it("rejects bad payloads and ignores suspended accounts with a 2xx", async () => {
    const { account, token } = await setup();
    const bad = await post("purchase", token, { email: "b@x.com", amount: "10", currency: "USD" });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { issues: string[] }).issues[0]).toContain("external_id");
    expect((await post("optin", token, { email: "nope" })).status).toBe(400);

    await db().update(accounts).set({ status: "suspended" }).where(eq(accounts.id, account.id));
    const ignored = await post("optin", token, { email: `s-${randomUUID()}@example.com` });
    expect(ignored.status).toBe(202);
    expect(await ignored.json()).toEqual({ ok: true, ignored: "account_suspended" });
    expect(await db().select().from(subscribers).where(eq(subscribers.accountId, account.id))).toHaveLength(0);
  });
});
