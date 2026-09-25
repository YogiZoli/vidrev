import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/db/client";
import { accounts, campaigns, channels, clicks, comments, customDomains, links, replies } from "@/db/schema";
import { encryptSecret } from "@/lib/crypto";
import { runMigrations } from "@/scripts/migrate";
import { createAccountWithUser } from "@/server/accounts";
import { approveReply, markSentManually, switchMatch } from "@/server/approval";
import type { EngineDeps } from "@/worker/polling";
import { sendReply } from "@/worker/sending";
import { ensureReplyLink, ensureStaticLink, resolveClick } from "./links";

const hasDb = Boolean(process.env.DATABASE_URL);
const key = randomBytes(32).toString("base64");
const now = new Date("2026-09-25T12:00:00Z");
const FALLBACK = "go.vidrev.app";
const browser = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148";

async function setup() {
  const db = getDb();
  const { account } = await createAccountWithUser(db, { email: `links-${randomUUID()}@example.com`, planCode: "standard_monthly" });
  const [channel] = await db
    .insert(channels)
    .values({
      accountId: account.id,
      youtubeChannelId: `UC${randomUUID()}`,
      status: "connected",
      accessTokenEnc: encryptSecret("access", key),
      refreshTokenEnc: encryptSecret("refresh", key),
      tokenExpiresAt: new Date(now.getTime() + 86_400_000),
    })
    .returning();
  const [guide, call] = await db
    .insert(campaigns)
    .values([
      { accountId: account.id, channelId: channel!.id, name: "G", keyword: "guide", destinationUrl: "https://coach.com/optin?ref=yt" },
      { accountId: account.id, channelId: channel!.id, name: "C", keyword: "call", intent: "hot", destinationUrl: "https://coach.com/call" },
    ])
    .returning();
  const [comment] = await db
    .insert(comments)
    .values({ channelId: channel!.id, youtubeCommentId: `yc-${randomUUID()}`, youtubeVideoId: "VID1", text: "guide call", publishedAt: now })
    .returning();
  const [reply] = await db
    .insert(replies)
    .values({
      accountId: account.id,
      channelId: channel!.id,
      commentId: comment!.id,
      campaignId: guide!.id,
      youtubeVideoId: "VID1",
      keyword: "guide",
      intent: "warm",
      otherMatches: [{ campaignId: call!.id, keyword: "call", intent: "hot" }],
      language: "en",
      body: "Here: {link}",
      draftSource: "template",
    })
    .returning();
  return { account, guide: guide!, call: call!, reply: reply! };
}

function click(slug: string, host = FALLBACK, userAgent = browser) {
  return resolveClick(
    getDb(),
    { slug, host, ip: "203.0.113.9", userAgent, country: "US", referer: "https://www.youtube.com/", ipSecret: "s", fallbackHost: FALLBACK },
    now,
  );
}

function slugOf(url: string) {
  return new URL(url).pathname.slice(1);
}

describe.skipIf(!hasDb)("tracked links (integration)", () => {
  beforeAll(async () => {
    await runMigrations(process.env.DATABASE_URL!);
  });

  afterEach(() => {
    delete process.env.LINK_FALLBACK_BASE_URL;
  });

  afterAll(async () => {
    await closeDb();
  });

  it("returns null without any link host", async () => {
    const { reply } = await setup();
    expect(await ensureReplyLink(getDb(), reply.id, { fallbackHost: null }, now)).toBeNull();
  });

  it("mints one link per reply that follows a keyword switch until posted", async () => {
    const { account, call, reply } = await setup();
    const first = await ensureReplyLink(getDb(), reply.id, { fallbackHost: FALLBACK }, now);
    expect(first!.url).toMatch(/^https:\/\/go\.vidrev\.app\/[2-9a-zA-Z]{7}$/);
    expect((await ensureReplyLink(getDb(), reply.id, { fallbackHost: FALLBACK }, now))!.url).toBe(first!.url);

    expect(await switchMatch(getDb(), account.id, reply.id, call.id)).toBe(true);
    await ensureReplyLink(getDb(), reply.id, { fallbackHost: FALLBACK }, now);
    const [link] = await getDb().select().from(links).where(eq(links.id, first!.id));
    expect(link).toMatchObject({ campaignId: call.id, keyword: "call", intent: "hot", destinationUrl: "https://coach.com/call", publishedAt: null });
  });

  it("uses the active custom domain, and a posted link never moves", async () => {
    const { account, reply } = await setup();
    const host = `go.${randomUUID().slice(0, 8)}.com`;
    await getDb().insert(customDomains).values({ accountId: account.id, hostname: host, status: "active" });
    const link = await ensureReplyLink(getDb(), reply.id, { fallbackHost: FALLBACK }, now);
    expect(link!.url.startsWith(`https://${host}/`)).toBe(true);

    expect(await markSentManually(getDb(), account.id, reply.id, undefined, now)).toBe(true);
    await getDb().update(customDomains).set({ status: "removed" }).where(eq(customDomains.accountId, account.id));
    expect((await ensureReplyLink(getDb(), reply.id, { fallbackHost: FALLBACK }, now))!.url).toBe(link!.url);
  });

  it("sends the reply with the tracked link and freezes it", async () => {
    process.env.LINK_FALLBACK_BASE_URL = `https://${FALLBACK}`;
    const { account, reply } = await setup();
    await approveReply(getDb(), { accountId: account.id, replyId: reply.id, body: "Here: {link}" }, now);
    const posts: string[] = [];
    const deps: EngineDeps = {
      db: getDb(),
      fetch: async (_url, init) => {
        posts.push(String(init?.body ?? ""));
        return Response.json({ id: "yt-reply-1" });
      },
      encryptionKey: key,
      google: { clientId: "c", clientSecret: "s" },
      now: () => now,
      quotaLimit: 1_000_000_000,
      enqueue: async () => {},
    };
    await sendReply(deps, reply.id);
    const text = JSON.parse(posts[0]!).snippet.textOriginal as string;
    expect(text).toMatch(/^Here: https:\/\/go\.vidrev\.app\/[2-9a-zA-Z]{7}$/);
    const [row] = await getDb().select().from(links).where(eq(links.slug, slugOf(text.slice(6))));
    expect(row!.publishedAt).toEqual(now);
    expect(row!.replyId).toBe(reply.id);
  });

  it("redirects with c2c_tid and UTM, logs the click with its mapping and sets the cookie on the creator domain", async () => {
    const { account, guide, reply } = await setup();
    const host = `go.${randomUUID().slice(0, 8)}.com`;
    await getDb().insert(customDomains).values({ accountId: account.id, hostname: host, status: "active" });
    const link = await ensureReplyLink(getDb(), reply.id, { fallbackHost: FALLBACK }, now);
    const result = await click(slugOf(link!.url), host);
    expect(result.kind).toBe("redirect");
    if (result.kind !== "redirect") return;
    const target = new URL(result.location);
    expect(target.origin + target.pathname).toBe("https://coach.com/optin");
    expect(target.searchParams.get("ref")).toBe("yt");
    const tid = target.searchParams.get("c2c_tid")!;
    expect(target.searchParams.get("utm_content")).toBe(tid);
    expect(result.setCookie).toContain(`c2c_tid=${tid}`);
    expect(result.setCookie).toContain(`Domain=${host.slice(3)}`);
    // The route turns this into the link_clicked webhook event.
    expect(result.clicked).toMatchObject({
      accountId: account.id,
      context: { tid, keyword: "guide", campaignId: guide.id, campaign: "G", videoId: "VID1", replyId: reply.id },
    });

    const [row] = await getDb().select().from(clicks).where(eq(clicks.tid, tid));
    expect(row).toMatchObject({
      accountId: account.id,
      replyId: reply.id,
      campaignId: guide.id,
      youtubeVideoId: "VID1",
      keyword: "guide",
      host,
      isBot: false,
      userAgentClass: "mobile",
      country: "US",
      referrerHost: "www.youtube.com",
    });
    expect(row!.ipHash).not.toContain("203.0.113.9");
  });

  it("gives bots no tid, sets no cookie on the fallback host, keeps redirecting when suspended without measuring", async () => {
    const { account, reply } = await setup();
    const link = await ensureReplyLink(getDb(), reply.id, { fallbackHost: FALLBACK }, now);
    const slug = slugOf(link!.url);

    const bot = await click(slug, FALLBACK, "Googlebot/2.1");
    expect(bot).toMatchObject({ kind: "redirect", setCookie: null, clicked: null });
    if (bot.kind === "redirect") expect(bot.location).not.toContain("c2c_tid");

    const human = await click(slug);
    expect(human).toMatchObject({ kind: "redirect", setCookie: null });
    if (human.kind === "redirect") expect(human.location).toContain("c2c_tid=");

    await getDb().update(accounts).set({ status: "suspended" }).where(eq(accounts.id, account.id));
    const before = (await getDb().select().from(clicks).where(eq(clicks.accountId, account.id))).length;
    const suspended = await click(slug);
    expect(suspended.kind).toBe("redirect");
    if (suspended.kind === "redirect") expect(suspended.location).toBe("https://coach.com/optin?ref=yt");
    expect((await getDb().select().from(clicks).where(eq(clicks.accountId, account.id))).length).toBe(before);
  });

  it("blocks the fallback host with the owner kill switch but keeps the own domain working", async () => {
    const { account, reply } = await setup();
    const link = await ensureReplyLink(getDb(), reply.id, { fallbackHost: FALLBACK }, now);
    await getDb().update(accounts).set({ fallbackLinksBlocked: true }).where(eq(accounts.id, account.id));
    expect(await click(slugOf(link!.url))).toEqual({ kind: "blocked" });
    expect((await click(slugOf(link!.url), "go.other.com")).kind).toBe("redirect");
    expect(await click("zzzzzzz")).toEqual({ kind: "not_found" });
    expect(await click("../etc")).toEqual({ kind: "not_found" });
  });

  it("keeps redirecting after the campaign is deleted, and reuses static links", async () => {
    const { account, guide, reply } = await setup();
    const input = { accountId: account.id, campaignId: guide.id, youtubeVideoId: "VID1", fallbackHost: FALLBACK };
    const staticLink = await ensureStaticLink(getDb(), input, now);
    expect(await ensureStaticLink(getDb(), input, now)).toEqual(staticLink);
    const channelWide = await ensureStaticLink(getDb(), { ...input, youtubeVideoId: null }, now);
    expect(channelWide!.url).not.toBe(staticLink!.url);
    expect(await ensureStaticLink(getDb(), { ...input, accountId: randomUUID() }, now)).toBeNull();

    const link = await ensureReplyLink(getDb(), reply.id, { fallbackHost: FALLBACK }, now);
    await markSentManually(getDb(), account.id, reply.id, undefined, now);
    await getDb().delete(campaigns).where(eq(campaigns.id, guide.id));
    for (const url of [link!.url, staticLink!.url]) {
      const result = await click(slugOf(url));
      expect(result.kind).toBe("redirect");
      if (result.kind === "redirect") expect(result.location.startsWith("https://coach.com/optin?ref=yt&c2c_tid=")).toBe(true);
    }
  });
});
