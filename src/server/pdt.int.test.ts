import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/db/client";
import { accounts, auditLog, campaigns, channels, links, pdtConnectCodes, pdtConnections, publishingCardKeywords, purchases, replies, subscribers } from "@/db/schema";
import type { SendEmailJob } from "@/jobs/queues";
import { sha256Hex } from "@/lib/crypto";
import { runMigrations } from "@/scripts/migrate";
import { createAccountWithUser } from "./accounts";
import { exchangeConnectCode, issueConnectCode } from "./pdt";
import { cardsRoute, outcomesRoute, type PdtApiDeps, publishedRoute, revokeRoute, tokenRoute } from "./pdt-api";
import { cardOffer } from "./publishing-cards";

const hasDb = Boolean(process.env.DATABASE_URL);
const VIDEO = "dQw4w9WgXcQ";

function deps(emails: SendEmailJob[] = []): PdtApiDeps {
  return {
    db: getDb(),
    fallbackHost: "go.vidrev.test",
    enqueueEmail: async (job) => void emails.push(job),
    appBaseUrl: "https://app.vidrev.test",
    productName: "vidrev",
  };
}

function req(path: string, token: string | null, body?: unknown, method = "POST"): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request(`https://app.vidrev.test${path}`, { method, headers, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
}

async function connected(options: { defaultTargetUrl?: string | null; channel?: boolean; status?: "active" | "registered" } = {}) {
  const db = getDb();
  const { account, user } = await createAccountWithUser(db, { email: `pdt-${randomUUID()}@example.com`, name: "Zoltan Channel", planCode: "standard_monthly", status: options.status ?? "active" });
  await db.update(accounts).set({ defaultTargetUrl: options.defaultTargetUrl === undefined ? "https://zoltan.example.com/start" : options.defaultTargetUrl }).where(eq(accounts.id, account.id));
  const [channel] = options.channel === false ? [] : await db.insert(channels).values({ accountId: account.id, youtubeChannelId: `UC${randomUUID()}`, status: "connected" }).returning();
  const code = await issueConnectCode(db, { accountId: account.id, userId: user.id, redirectOrigin: "https://dreamteam.commentclient.com" });
  const response = await tokenRoute(deps(), req("/api/v1/connect/token", null, { code }), `10.0.0.${Math.floor(Math.random() * 250)}`);
  const body = (await response.json()) as { token: string; accountName: string };
  return { db, account, user, channel, token: body.token, accountName: body.accountName, status: response.status };
}

const card = (extra: Record<string, unknown> = {}) => ({
  schema: "video-publishing-card/1",
  cardId: randomUUID(),
  createdAt: "2026-10-08T10:00:00Z",
  video: { title: "How I plan a week", seconds: 600, language: "en" },
  landingUrl: "https://zoltan.example.com/guide",
  chapters: [{ start: 0, title: "Intro" }],
  commentCalls: [
    { slot: "start", keyword: "GUIDE", temperature: "cold", gets: "the weekly planning guide", start: 30 },
    { slot: "end", keyword: "CALL", temperature: "hot" },
  ],
  ...extra,
});

describe.skipIf(!hasDb)("PDT connection (integration)", () => {
  beforeAll(async () => {
    process.env.APP_BASE_URL = "https://app.vidrev.test";
    process.env.LINK_FALLBACK_BASE_URL = "https://go.vidrev.test";
    await runMigrations(process.env.DATABASE_URL!);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("trades a one-time code for a hashed token; a new connect revokes the old one", async () => {
    const { db, account, user, token, accountName, status } = await connected();
    expect(status).toBe(200);
    expect(token).toMatch(/^vidrev_pat_/);
    expect(accountName).toBe("Zoltan Channel");
    const [stored] = await db.select().from(pdtConnections).where(eq(pdtConnections.accountId, account.id));
    expect(stored?.tokenHash).toBe(sha256Hex(token));
    expect(JSON.stringify(await db.select().from(pdtConnections))).not.toContain(token);

    // A used code does not work twice; an expired one never.
    const code = await issueConnectCode(db, { accountId: account.id, userId: user.id, redirectOrigin: "x" });
    const second = await exchangeConnectCode(db, code);
    expect(second?.token).toMatch(/^vidrev_pat_/);
    expect(await exchangeConnectCode(db, code)).toBeNull();
    const old = await issueConnectCode(db, { accountId: account.id, userId: user.id, redirectOrigin: "x" }, new Date(Date.now() - 11 * 60_000));
    const bad = await tokenRoute(deps(), req("/api/v1/connect/token", null, { code: old }), "10.1.1.1");
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: expect.stringContaining("expired") });
    expect((await tokenRoute(deps(), req("/api/v1/connect/token", null, "{}"), "10.1.1.2")).status).toBe(400);

    // The first token was replaced by the second connect.
    const refused = await cardsRoute(deps(), req("/api/v1/cards", token, card()));
    expect(refused.status).toBe(401);
    expect(await refused.json()).toEqual({ error: expect.any(String) });
    const live = await db.select().from(pdtConnections).where(and(eq(pdtConnections.accountId, account.id)));
    expect(live.filter((c) => c.revokedAt === null)).toHaveLength(1);
    expect((await db.select().from(pdtConnectCodes).where(eq(pdtConnectCodes.accountId, account.id))).every((c) => c.codeHash.length === 64)).toBe(true);
  });

  it("stores a card as a waiting automation: links per keyword, no rule, no quota", async () => {
    const { db, account, token } = await connected();
    const sent = card();
    const first = await cardsRoute(deps(), req("/api/v1/cards", token, sent));
    expect(first.status).toBe(201);
    const body = (await first.json()) as { cardId: string; links: { keyword: string; url: string }[] };
    expect(body.cardId).toBe(sent.cardId);
    expect(body.links.map((l) => l.keyword)).toEqual(["GUIDE", "CALL"]);
    expect(body.links[0]!.url).toMatch(/^https:\/\/go\.vidrev\.test\/[A-Za-z0-9]{7}$/);
    // Pending: no campaign exists, so the engine has nothing to poll or draft.
    expect(await db.select().from(campaigns).where(eq(campaigns.accountId, account.id))).toEqual([]);
    const cardLinks = await db.select().from(links).where(eq(links.accountId, account.id));
    expect(cardLinks.every((l) => l.kind === "card" && l.youtubeVideoId === null && l.destinationUrl === "https://zoltan.example.com/guide")).toBe(true);

    // Resend: same links, updated card; a dropped keyword stops waiting.
    const again = await cardsRoute(deps(), req("/api/v1/cards", token, { ...sent, commentCalls: [sent.commentCalls[0]], landingUrl: "https://zoltan.example.com/v2" }));
    expect(again.status).toBe(200);
    const againBody = (await again.json()) as { links: { keyword: string; url: string }[] };
    expect(againBody.links).toEqual([body.links[0]]);
    const [guide] = await db.select().from(links).where(eq(links.accountId, account.id)).then((rows) => rows.filter((r) => r.keyword === "GUIDE"));
    expect(guide?.destinationUrl).toBe("https://zoltan.example.com/v2");
    expect(await db.select().from(publishingCardKeywords).where(eq(publishingCardKeywords.accountId, account.id))).toHaveLength(1);
  });

  it("refuses bad cards with a sentence, and the own host as landing page", async () => {
    const { token } = await connected();
    const invalid = await cardsRoute(deps(), req("/api/v1/cards", token, { schema: "video-publishing-card/2", cardId: randomUUID() }));
    expect(invalid.status).toBe(422);
    expect(((await invalid.json()) as { error: string }).error).toContain("format version 2");
    const notJson = await cardsRoute(deps(), req("/api/v1/cards", token, "{oops"));
    expect(notJson.status).toBe(422);
    const big = await cardsRoute(deps(), new Request("https://app.vidrev.test/api/v1/cards", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-length": String(3 * 1024 * 1024) }, body: "{}" }));
    expect(big.status).toBe(413);
    const ownHost = await cardsRoute(deps(), req("/api/v1/cards", token, card({ landingUrl: "https://go.vidrev.test/x" })));
    expect(ownHost.status).toBe(422);
    expect(((await ownHost.json()) as { error: string }).error).toContain("own link or app domain");
  });

  it("needs a target: the card's landing page, else the default target URL", async () => {
    const none = await connected({ defaultTargetUrl: null });
    const refused = await cardsRoute(deps(), req("/api/v1/cards", none.token, card({ landingUrl: null })));
    expect(refused.status).toBe(422);
    const fallback = await connected();
    const made = await cardsRoute(deps(), req("/api/v1/cards", fallback.token, card({ landingUrl: null })));
    expect(made.status).toBe(201);
    const rows = await fallback.db.select().from(links).where(eq(links.accountId, fallback.account.id));
    expect(rows.every((l) => l.destinationUrl === "https://zoltan.example.com/start")).toBe(true);
  });

  it("arms the card on publish: one rule per keyword on that video, links tied to it, idempotent, one email", async () => {
    const { db, account, channel, token } = await connected();
    const sent = card();
    const linksBody = (await (await cardsRoute(deps(), req("/api/v1/cards", token, sent))).json()) as { links: { keyword: string; url: string }[] };
    const emails: SendEmailJob[] = [];
    const first = await publishedRoute(deps(emails), req(`/api/v1/cards/${sent.cardId}/published`, token, { videoId: VIDEO }), sent.cardId);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ armed: ["GUIDE", "CALL"], alreadyLive: [], notArmed: [] });
    const rules = await db.select().from(campaigns).where(eq(campaigns.accountId, account.id));
    expect(rules).toHaveLength(2);
    const guide = rules.find((r) => r.keyword === "GUIDE")!;
    expect(guide).toMatchObject({ channelId: channel!.id, videoIds: [VIDEO], intent: "cold", destinationUrl: "https://zoltan.example.com/guide", name: "a free guide", active: true });
    expect(guide.aliases).toContain("GUDIE");
    const cardLinks = await db.select().from(links).where(eq(links.accountId, account.id));
    expect(cardLinks.every((l) => l.youtubeVideoId === VIDEO && l.campaignId !== null)).toBe(true);
    expect(emails).toHaveLength(1);
    expect(emails[0]!.text).toContain("Now live on this video: GUIDE, CALL");
    expect(emails[0]!.text).toContain(`watch?v=${VIDEO}`);

    // Same call again: same answer, no new rule, no second email, same links.
    const again = await publishedRoute(deps(emails), req(`/api/v1/cards/${sent.cardId}/published`, token, { videoId: VIDEO }), sent.cardId);
    expect(await again.json()).toEqual({ armed: ["GUIDE", "CALL"], alreadyLive: [], notArmed: [] });
    expect(await db.select().from(campaigns).where(eq(campaigns.accountId, account.id))).toHaveLength(2);
    expect(emails).toHaveLength(1);
    const resend = (await (await cardsRoute(deps(), req("/api/v1/cards", token, sent))).json()) as { links: unknown };
    expect(resend.links).toEqual(linksBody.links);

    // The AI draft gets the card's offer for this video and keyword.
    expect(await cardOffer(db, account.id, VIDEO, "guide")).toBe("the weekly planning guide");
    expect(await cardOffer(db, account.id, VIDEO, "CALL")).toBeNull();
    expect(await cardOffer(db, account.id, "otherVideo1", "GUIDE")).toBeNull();

    // Another video for the same card is refused.
    const other = await publishedRoute(deps(), req(`/api/v1/cards/${sent.cardId}/published`, token, { videoId: "abcdefghijk" }), sent.cardId);
    expect(other.status).toBe(409);
    const audit = await db.select().from(auditLog).where(and(eq(auditLog.accountId, account.id), eq(auditLog.action, "card.published")));
    expect(audit).toHaveLength(1);
  });

  it("never duplicates a live rule (RR-07) and takes the All my videos target first", async () => {
    const { db, account, channel, token } = await connected();
    await db.insert(campaigns).values([
      { accountId: account.id, channelId: channel!.id, name: "a free guide", keyword: "GUIDE", intent: "cold", destinationUrl: "https://zoltan.example.com/all-guide", videoIds: null },
      { accountId: account.id, channelId: channel!.id, name: "a call", keyword: "CALL", intent: "hot", destinationUrl: "https://zoltan.example.com/call", videoIds: [VIDEO], active: false },
    ]);
    const sent = card({ commentCalls: [...card().commentCalls, { slot: "middle", keyword: "TEMPLATE", temperature: "cold" }] });
    await cardsRoute(deps(), req("/api/v1/cards", token, sent));
    const guideLink = (await db.select().from(links).where(and(eq(links.accountId, account.id), eq(links.keyword, "GUIDE"))))[0]!;
    expect(guideLink.destinationUrl).toBe("https://zoltan.example.com/all-guide");
    const result = await publishedRoute(deps(), req(`/api/v1/cards/${sent.cardId}/published`, token, { videoId: VIDEO }), sent.cardId);
    expect(await result.json()).toEqual({
      armed: ["TEMPLATE"],
      alreadyLive: ["GUIDE"],
      notArmed: [{ keyword: "CALL", reason: "CALL is watched on this video by a paused automation. Resume it in vidrev." }],
    });
    const rules = await db.select().from(campaigns).where(eq(campaigns.accountId, account.id));
    expect(rules).toHaveLength(3);
    const [linked] = await db.select().from(links).where(eq(links.id, guideLink.id));
    expect(linked?.campaignId).toBe(rules.find((r) => r.keyword === "GUIDE")!.id);
    expect(linked?.youtubeVideoId).toBe(VIDEO);
  });

  it("refuses publish without a channel, for an unknown card and for a locked account", async () => {
    const noChannel = await connected({ channel: false });
    const sent = card();
    await cardsRoute(deps(), req("/api/v1/cards", noChannel.token, sent));
    const refused = await publishedRoute(deps(), req(`/api/v1/cards/${sent.cardId}/published`, noChannel.token, { videoId: VIDEO }), sent.cardId);
    expect(refused.status).toBe(409);
    const unknown = randomUUID();
    expect((await publishedRoute(deps(), req(`/api/v1/cards/${unknown}/published`, noChannel.token, { videoId: VIDEO }), unknown)).status).toBe(404);
    expect((await publishedRoute(deps(), req(`/api/v1/cards/${sent.cardId}/published`, noChannel.token, { videoId: "short" }), sent.cardId)).status).toBe(400);
    const locked = await connected({ status: "registered" });
    expect((await cardsRoute(deps(), req("/api/v1/cards", locked.token, card()))).status).toBe(403);
  });

  it("answers outcomes with counts only, per keyword, people counted once", async () => {
    const { db, account, channel, token } = await connected();
    const sent = card();
    await cardsRoute(deps(), req("/api/v1/cards", token, sent));
    await publishedRoute(deps(), req(`/api/v1/cards/${sent.cardId}/published`, token, { videoId: VIDEO }), sent.cardId);
    const personA = randomUUID();
    const base = { accountId: account.id, channelId: channel!.id, youtubeVideoId: VIDEO, intent: "cold" as const, language: "en", body: "Here {link}", draftSource: "template" as const };
    await db.insert(replies).values([
      { ...base, keyword: "GUIDE", contactId: personA },
      { ...base, keyword: "GUIDE", contactId: personA },
      { ...base, keyword: "GUIDE", contactId: randomUUID() },
      { ...base, keyword: "GUIDE", youtubeVideoId: "otherVideo1" },
    ]);
    const now = new Date();
    await db.insert(subscribers).values([
      { accountId: account.id, emailNorm: "a@example.com", contactId: personA, source: "webhook", dedupeKey: "1", keyword: "GUIDE", youtubeVideoId: VIDEO, occurredAt: now },
      { accountId: account.id, emailNorm: "a@example.com", contactId: personA, source: "webhook", dedupeKey: "2", keyword: "GUIDE", youtubeVideoId: VIDEO, occurredAt: now },
    ]);
    const paid = randomUUID();
    const duplicate = randomUUID();
    const foreign = randomUUID();
    await db.insert(purchases).values([
      { id: paid, accountId: account.id, source: "stripe", externalId: "ch_1", emailNorm: "a@example.com", contactId: personA, amountCents: 9700, currency: "USD", netCents: 9700, canonicalPurchaseId: paid, attributionMethod: "tid", attributedVideoId: VIDEO, attributedKeyword: "GUIDE", occurredAt: now },
      { id: duplicate, accountId: account.id, source: "ghl", externalId: "p_1", emailNorm: "a@example.com", contactId: personA, amountCents: 9700, currency: "USD", netCents: 0, canonicalPurchaseId: paid, attributionMethod: "tid", attributedVideoId: VIDEO, attributedKeyword: "GUIDE", occurredAt: now },
      { id: foreign, accountId: account.id, source: "stripe", externalId: "ch_2", emailNorm: "b@example.com", amountCents: 5000, currency: "EUR", netCents: 5000, canonicalPurchaseId: foreign, attributionMethod: "tid", attributedVideoId: VIDEO, attributedKeyword: "GUIDE", occurredAt: now },
    ]);
    const response = await outcomesRoute(deps(), req(`/api/v1/videos/${VIDEO}/outcomes`, token, undefined, "GET"), VIDEO);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      videoId: VIDEO,
      currency: "USD",
      keywords: [
        { keyword: "CALL", commenters: 0, emailSubscribers: 0, buyers: 0, revenue: 0 },
        { keyword: "GUIDE", commenters: 2, emailSubscribers: 1, buyers: 2, revenue: 97 },
      ],
    });
    expect((await outcomesRoute(deps(), req("/api/v1/videos/x/outcomes", token, undefined, "GET"), "x")).status).toBe(400);
    expect((await outcomesRoute(deps(), req(`/api/v1/videos/${VIDEO}/outcomes`, "vidrev_pat_wrong", undefined, "GET"), VIDEO)).status).toBe(401);
  });

  it("revokes the token at once", async () => {
    const { token } = await connected();
    const revoked = await revokeRoute(deps(), req("/api/v1/connect/revoke", token));
    expect(await revoked.json()).toEqual({ revoked: true });
    expect((await revokeRoute(deps(), req("/api/v1/connect/revoke", token))).status).toBe(401);
    expect((await outcomesRoute(deps(), req(`/api/v1/videos/${VIDEO}/outcomes`, token, undefined, "GET"), VIDEO)).status).toBe(401);
  });
});
