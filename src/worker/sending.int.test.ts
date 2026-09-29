import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/db/client";
import { accounts, campaigns, channels, comments, quotaLedger, replies } from "@/db/schema";
import { encryptSecret } from "@/lib/crypto";
import { runMigrations } from "@/scripts/migrate";
import { createAccountWithUser } from "@/server/accounts";
import { approveReply, markSentManually } from "@/server/approval";
import type { EngineDeps } from "./polling";
import { fairOrder, ORPHANED_AFTER_MS, recoverUnconfirmedSends, releaseQueued, requeueOrphanedApproved, sendReply, UNCONFIRMED_AFTER_MS } from "./sending";

const hasDb = Boolean(process.env.DATABASE_URL);
const key = randomBytes(32).toString("base64");
const now = new Date("2026-09-25T12:00:00Z");

function engine(opts: { quotaLimit?: number; status?: number; reason?: string; at?: Date } = {}) {
  const posts: { url: string; body: string }[] = [];
  const sent: { queue: string; data: unknown }[] = [];
  const deps: EngineDeps = {
    db: getDb(),
    fetch: async (url, init) => {
      posts.push({ url, body: String(init?.body ?? "") });
      if (opts.status) return Response.json({ error: { errors: [{ reason: opts.reason ?? "forbidden" }] } }, { status: opts.status });
      return Response.json({ id: "yt-reply-1" });
    },
    encryptionKey: key,
    google: { clientId: "c", clientSecret: "s" },
    now: () => opts.at ?? now,
    quotaLimit: opts.quotaLimit ?? 1_000_000_000,
    enqueue: async (queue, data) => {
      sent.push({ queue, data });
    },
  };
  return { deps, posts, sent };
}

async function draft() {
  const db = getDb();
  const { account } = await createAccountWithUser(db, { email: `send-${randomUUID()}@example.com`, planCode: "standard_monthly" });
  // Onboarding done (Phase 14): polling and drafts run only after it.
  await db.update(accounts).set({ onboardedAt: new Date() }).where(eq(accounts.id, account.id));
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
  const [campaign] = await db
    .insert(campaigns)
    .values({ accountId: account.id, channelId: channel!.id, name: "G", keyword: "guide", destinationUrl: "https://e.com/optin" })
    .returning();
  const [comment] = await db
    .insert(comments)
    .values({ channelId: channel!.id, youtubeCommentId: `yc-${randomUUID()}`, youtubeVideoId: "VID1", text: "guide", publishedAt: now })
    .returning();
  const [reply] = await db
    .insert(replies)
    .values({
      accountId: account.id,
      channelId: channel!.id,
      commentId: comment!.id,
      campaignId: campaign!.id,
      youtubeVideoId: "VID1",
      keyword: "guide",
      intent: "warm",
      language: "en",
      body: "Here: {link}",
      draftSource: "template",
    })
    .returning();
  return { account, reply: reply!, comment: comment! };
}

async function status(id: string) {
  const [row] = await getDb().select().from(replies).where(eq(replies.id, id));
  return row!;
}

describe("fairOrder", () => {
  it("interleaves accounts, FIFO within each", () => {
    const rows = [
      { id: 1, accountId: "a" },
      { id: 2, accountId: "a" },
      { id: 3, accountId: "a" },
      { id: 4, accountId: "b" },
      { id: 5, accountId: "c" },
    ];
    expect(fairOrder(rows).map((r) => r.id)).toEqual([1, 4, 5, 2, 3]);
  });
});

describe.skipIf(!hasDb)("approval and sending (integration)", () => {
  beforeAll(async () => {
    await runMigrations(process.env.DATABASE_URL!);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("approves one reply and sends it right away with the link filled in", async () => {
    const { account, reply, comment } = await draft();
    expect(await approveReply(getDb(), { accountId: account.id, replyId: reply.id, body: "Subscribe: {link}" }, now)).toEqual({
      ok: false,
      error: "engagement_bait",
    });
    expect(await approveReply(getDb(), { accountId: randomUUID(), replyId: reply.id, body: "x {link}" }, now)).toMatchObject({ ok: false });
    expect(await approveReply(getDb(), { accountId: account.id, replyId: reply.id, body: "Edited: {link}" }, now)).toEqual({ ok: true });

    const { deps, posts } = engine();
    await sendReply(deps, reply.id);
    expect(JSON.parse(posts[0]!.body)).toEqual({ snippet: { parentId: comment.youtubeCommentId, textOriginal: "Edited: https://e.com/optin" } });
    expect(await status(reply.id)).toMatchObject({ status: "sent", youtubeReplyId: "yt-reply-1" });

    // A duplicate job does not post twice.
    await sendReply(deps, reply.id);
    expect(posts).toHaveLength(1);
  });

  it("books the 50 units once when two jobs race for the same reply", async () => {
    const { account, reply } = await draft();
    await approveReply(getDb(), { accountId: account.id, replyId: reply.id, body: "Here: {link}" }, now);
    const { deps, posts } = engine();
    await Promise.all([sendReply(deps, reply.id), sendReply(deps, reply.id)]);
    expect(posts).toHaveLength(1);
    const booked = await getDb().select().from(quotaLedger).where(eq(quotaLedger.accountId, account.id));
    expect(booked.filter((row) => row.method === "comments.insert")).toHaveLength(1);
  });

  it("queues for the next Pacific day when the quota is used up, then sends first after the reset", async () => {
    const { account, reply } = await draft();
    await approveReply(getDb(), { accountId: account.id, replyId: reply.id, body: "Here: {link}" }, now);
    const full = engine({ quotaLimit: 0 });
    await sendReply(full.deps, reply.id);
    expect(full.posts).toEqual([]);
    expect(await status(reply.id)).toMatchObject({ status: "queued", queuedForDatePt: "2026-09-26", statusReason: "daily_quota" });

    const sameDay = engine();
    await releaseQueued(sameDay.deps);
    expect(sameDay.sent.some((s) => (s.data as { replyId: string }).replyId === reply.id)).toBe(false);

    const tomorrow = engine({ at: new Date("2026-09-26T07:05:00Z") });
    await releaseQueued(tomorrow.deps);
    expect(tomorrow.sent).toContainEqual({ queue: "reply.send", data: { replyId: reply.id } });
    expect((await status(reply.id)).status).toBe("approved");
  });

  it("fails without retry on a policy error", async () => {
    const { account, reply } = await draft();
    await approveReply(getDb(), { accountId: account.id, replyId: reply.id, body: "Here: {link}" }, now);
    await sendReply(engine({ status: 403, reason: "commentsDisabled" }).deps, reply.id);
    expect(await status(reply.id)).toMatchObject({ status: "failed", statusReason: "commentsDisabled" });
  });

  it("enforces the daily safety ceiling of 30 and lets the creator post by hand", async () => {
    const first = await draft();
    const extra = await Promise.all(Array.from({ length: 30 }, () => draft()));
    // Put 30 approved replies on the first account today.
    for (const d of extra) {
      await getDb().update(replies).set({ accountId: first.account.id, status: "sent", approvedAt: now }).where(eq(replies.id, d.reply.id));
    }
    expect(await approveReply(getDb(), { accountId: first.account.id, replyId: first.reply.id, body: "Here: {link}" }, now)).toEqual({
      ok: false,
      error: "daily_cap",
    });
    expect(await markSentManually(getDb(), first.account.id, first.reply.id, undefined, now)).toBe(true);
    expect((await status(first.reply.id)).status).toBe("sent_manually");
  });
  // A fetch that fails the POST as told and answers the replies lookup.
  function flaky(post: "network" | "5xx", repliesFound: { authorChannelId: string; publishedAt: string }[] = [], at = now) {
    const posts: string[] = [];
    const lookups: string[] = [];
    const sent: { queue: string; data: unknown }[] = [];
    const deps: EngineDeps = {
      db: getDb(),
      fetch: async (url, init) => {
        if (init?.method === "POST") {
          posts.push(url);
          if (post === "network") throw new TypeError("fetch failed");
          return Response.json({ error: { errors: [{ reason: "backendError" }] } }, { status: 503 });
        }
        lookups.push(url);
        return Response.json({ items: repliesFound.map((r, i) => ({ id: `found-${i}`, snippet: { authorChannelId: { value: r.authorChannelId }, publishedAt: r.publishedAt } })) });
      },
      encryptionKey: key,
      google: { clientId: "c", clientSecret: "s" },
      now: () => at,
      quotaLimit: 1_000_000_000,
      enqueue: async (queue, data) => {
        sent.push({ queue, data });
      },
    };
    return { deps, posts, lookups, sent };
  }

  async function channelOf(replyId: string) {
    const [row] = await getDb().select({ yt: channels.youtubeChannelId }).from(replies).innerJoin(channels, eq(channels.id, replies.channelId)).where(eq(replies.id, replyId));
    return row!.yt!;
  }

  it("retries a 5xx from YouTube, which posted nothing", async () => {
    const { account, reply } = await draft();
    await approveReply(getDb(), { accountId: account.id, replyId: reply.id, body: "Here: {link}" }, now);
    const { deps } = flaky("5xx");
    await expect(sendReply(deps, reply.id)).rejects.toThrow();
    expect((await status(reply.id)).status).toBe("approved");
  });

  it("never posts twice when YouTube does not answer: it checks, then confirms the live reply", async () => {
    const { account, reply } = await draft();
    await approveReply(getDb(), { accountId: account.id, replyId: reply.id, body: "Here: {link}" }, now);
    const lost = flaky("network");
    await sendReply(lost.deps, reply.id);
    expect(lost.posts).toHaveLength(1);
    expect((await status(reply.id)).status).toBe("sending");
    // A retried job does not post again while the outcome is unknown.
    await sendReply(lost.deps, reply.id);
    expect(lost.posts).toHaveLength(1);

    // Too early: nothing is checked yet.
    const early = flaky("network", [], new Date(now.getTime() + 60_000));
    await recoverUnconfirmedSends(early.deps);
    expect(early.lookups).toHaveLength(0);

    const later = new Date(now.getTime() + UNCONFIRMED_AFTER_MS + 60_000);
    const check = flaky("network", [{ authorChannelId: await channelOf(reply.id), publishedAt: now.toISOString() }], later);
    await recoverUnconfirmedSends(check.deps);
    expect(check.posts).toHaveLength(0);
    expect(await status(reply.id)).toMatchObject({ status: "sent", youtubeReplyId: "found-0" });
  });

  it("sends again only when YouTube shows no reply from the channel", async () => {
    const { account, reply } = await draft();
    await approveReply(getDb(), { accountId: account.id, replyId: reply.id, body: "Here: {link}" }, now);
    await sendReply(flaky("network").deps, reply.id);
    const later = new Date(now.getTime() + UNCONFIRMED_AFTER_MS + 60_000);
    // A reply by someone else does not count.
    const check = flaky("network", [{ authorChannelId: "UC-someone-else", publishedAt: now.toISOString() }], later);
    await recoverUnconfirmedSends(check.deps);
    expect((await status(reply.id)).status).toBe("approved");
    expect(check.sent).toContainEqual({ queue: "reply.send", data: { replyId: reply.id } });
  });

  it("queues an approved reply again when its send job was lost", async () => {
    const { account, reply } = await draft();
    await approveReply(getDb(), { accountId: account.id, replyId: reply.id, body: "Here: {link}" }, now);
    // Age the row as if the job never ran.
    await getDb().update(replies).set({ updatedAt: now }).where(eq(replies.id, reply.id));
    const mine = (sent: { data: unknown }[]) => sent.filter((s) => (s.data as { replyId: string }).replyId === reply.id);

    const early = engine({ at: new Date(now.getTime() + 60_000) });
    await requeueOrphanedApproved(early.deps);
    expect(mine(early.sent)).toHaveLength(0);

    const later = new Date(now.getTime() + ORPHANED_AFTER_MS + 60_000);
    const late = engine({ at: later });
    await requeueOrphanedApproved(late.deps);
    expect(late.sent).toContainEqual({ queue: "reply.send", data: { replyId: reply.id } });
    // Not queued again on the next tick.
    const next = engine({ at: new Date(later.getTime() + 60_000) });
    await requeueOrphanedApproved(next.deps);
    expect(mine(next.sent)).toHaveLength(0);

    await sendReply(late.deps, reply.id);
    expect((await status(reply.id)).status).toBe("sent");
  });

  it("fails an unconfirmed send with a reason when the channel is gone", async () => {
    const { account, reply } = await draft();
    await approveReply(getDb(), { accountId: account.id, replyId: reply.id, body: "Here: {link}" }, now);
    await sendReply(flaky("network").deps, reply.id);
    await getDb().update(channels).set({ status: "revoked" }).where(eq(channels.id, reply.channelId));
    const check = flaky("network", [], new Date(now.getTime() + UNCONFIRMED_AFTER_MS + 60_000));
    await recoverUnconfirmedSends(check.deps);
    expect(await status(reply.id)).toMatchObject({ status: "failed", statusReason: "send_unconfirmed" });
    expect(check.lookups).toHaveLength(0);
  });
});
