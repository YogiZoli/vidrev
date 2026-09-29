import { and, asc, eq, lt, lte } from "drizzle-orm";
import { campaigns, channels, comments, links, replies } from "@/db/schema";
import { fallbackHost } from "@/lib/link-host";
import { errorFields, log } from "@/lib/log";
import { repliesLeftToday } from "@/lib/quota";
import { renderReply } from "@/lib/templates";
import { nextPacificMidnight, pacificDate } from "@/lib/time";
import { replyContext } from "@/server/integrations/context";
import { emitEventSafely, kickWith } from "@/server/integrations/events";
import { ensureReplyLink, publishLink } from "@/server/links";
import { dayUsage, reserveUnits } from "@/server/quota";
import { insertReply, listReplies, YoutubeApiError } from "@/server/youtube/api";
import { ChannelRevokedError, getAccessToken } from "./channels";
import type { EngineDeps } from "./polling";

// Sends one approved reply (D-31b): right away when it fits today's quota,
// otherwise it waits in the queue for the midnight Pacific reset.
export async function sendReply(deps: EngineDeps, replyId: string): Promise<void> {
  const now = deps.now?.() ?? new Date();
  const [row] = await deps.db
    .select({ reply: replies, comment: comments, channel: channels, campaign: campaigns })
    .from(replies)
    .innerJoin(channels, eq(channels.id, replies.channelId))
    .leftJoin(comments, eq(comments.id, replies.commentId))
    .leftJoin(campaigns, eq(campaigns.id, replies.campaignId))
    .where(eq(replies.id, replyId));
  if (!row || row.reply.status !== "approved") return;
  const { reply, comment, channel, campaign } = row;
  const fail = (reason: string) =>
    deps.db.update(replies).set({ status: "failed", statusReason: reason, updatedAt: now }).where(eq(replies.id, reply.id));

  if (!comment) return void (await fail("comment_gone"));
  if (!campaign) return void (await fail("campaign_deleted"));
  if (channel.status !== "connected") return void (await fail("channel_not_connected"));

  if (!(await reserveUnits(deps.db, { method: "comments.insert", accountId: reply.accountId, limit: deps.quotaLimit }, now))) {
    await queueForTomorrow(deps, reply.id, now);
    return;
  }
  // Claim the reply so a duplicate job cannot post it twice.
  const claimed = await deps.db
    .update(replies)
    .set({ status: "sending", attempts: reply.attempts + 1, updatedAt: now })
    .where(and(eq(replies.id, reply.id), eq(replies.status, "approved")))
    .returning({ id: replies.id });
  if (claimed.length === 0) return;

  // Before the post nothing has reached YouTube: any error returns the reply
  // to approved and pg-boss retries.
  let token: string;
  let link: Awaited<ReturnType<typeof ensureReplyLink>>;
  try {
    token = await getAccessToken(deps, channel);
    // The tracked link on the creator's domain; the destination URL only
    // while no link host is configured at all.
    link = await ensureReplyLink(deps.db, reply.id, { fallbackHost: fallbackHost() }, now);
  } catch (error) {
    if (error instanceof ChannelRevokedError) return void (await fail("channel_revoked"));
    await deps.db.update(replies).set({ status: "approved", updatedAt: now }).where(eq(replies.id, reply.id));
    throw error;
  }

  let posted: { id: string };
  try {
    posted = await insertReply(deps.fetch, token, comment.youtubeCommentId, renderReply(reply.body, link?.url ?? campaign.destinationUrl));
  } catch (error) {
    if (error instanceof YoutubeApiError && error.quotaExceeded) {
      await queueForTomorrow(deps, reply.id, now);
      return;
    }
    // Policy and permission errors never fix themselves: no retry.
    if (error instanceof YoutubeApiError && error.status >= 400 && error.status < 500) {
      log("warn", "reply refused by YouTube", { replyId: reply.id, status: error.status, reason: error.reason });
      return void (await fail(error.reason));
    }
    // YouTube answered 5xx: nothing was posted, retry.
    if (error instanceof YoutubeApiError) {
      await deps.db.update(replies).set({ status: "approved", updatedAt: now }).where(eq(replies.id, reply.id));
      throw error;
    }
    // No answer (timeout, connection lost): the reply may be live. It stays
    // "sending"; recoverUnconfirmedSends checks YouTube before any retry, so
    // a reply is never posted twice.
    log("error", "reply send outcome unknown, will verify with YouTube", { replyId: reply.id, ...errorFields(error) });
    return;
  }

  // Posted. From here the reply never goes back to approved: a failed write
  // below leaves it "sending" and the recovery confirms it as sent.
  await markSent(deps, reply.id, posted.id, link?.id ?? null, now);
  log("info", "reply sent", { replyId: reply.id, accountId: reply.accountId, youtubeReplyId: posted.id });
  await emitReplyPosted(deps, reply.id, now);
}

async function markSent(deps: EngineDeps, replyId: string, youtubeReplyId: string, linkId: string | null, now: Date): Promise<void> {
  if (linkId) await publishLink(deps.db, linkId, now);
  await deps.db
    .update(replies)
    .set({ status: "sent", sentAt: now, youtubeReplyId, statusReason: null, queuedForDatePt: null, updatedAt: now })
    .where(eq(replies.id, replyId));
}

// A send stays "sending" only when its outcome is unknown (no answer from
// YouTube, or a crash or failed write after the post). After 10 minutes the
// comment's replies are read (1 unit): the channel's reply found means sent;
// not found means back to approved and sent again. When YouTube cannot be
// asked, the reply is failed with a reason the creator sees.
export const UNCONFIRMED_AFTER_MS = 10 * 60_000;

export async function recoverUnconfirmedSends(deps: EngineDeps): Promise<number> {
  const now = deps.now?.() ?? new Date();
  const stuck = await deps.db
    .select({ reply: replies, comment: comments, channel: channels })
    .from(replies)
    .innerJoin(channels, eq(channels.id, replies.channelId))
    .leftJoin(comments, eq(comments.id, replies.commentId))
    .where(and(eq(replies.status, "sending"), lt(replies.updatedAt, new Date(now.getTime() - UNCONFIRMED_AFTER_MS))))
    .limit(50);
  for (const { reply, comment, channel } of stuck) {
    const failed = (reason: string) =>
      deps.db
        .update(replies)
        .set({ status: "failed", statusReason: reason, updatedAt: now })
        .where(and(eq(replies.id, reply.id), eq(replies.status, "sending")));
    try {
      if (!comment || !channel.youtubeChannelId || channel.status !== "connected") {
        await failed("send_unconfirmed");
        log("error", "reply send unconfirmed, cannot check YouTube", { replyId: reply.id, accountId: reply.accountId });
        continue;
      }
      if (!(await reserveUnits(deps.db, { method: "comments.list", accountId: reply.accountId, limit: deps.quotaLimit }, now))) continue;
      const token = await getAccessToken(deps, channel);
      const claimedAt = reply.updatedAt.getTime() - 60_000;
      const found = ((await listReplies(deps.fetch, token, comment.youtubeCommentId)).items ?? []).find(
        (item) =>
          item.snippet?.authorChannelId?.value === channel.youtubeChannelId &&
          (!item.snippet.publishedAt || new Date(item.snippet.publishedAt).getTime() >= claimedAt),
      );
      if (found) {
        const [link] = await deps.db.select({ id: links.id }).from(links).where(eq(links.replyId, reply.id));
        await markSent(deps, reply.id, found.id, link?.id ?? null, now);
        log("info", "reply send confirmed on YouTube", { replyId: reply.id, youtubeReplyId: found.id });
        await emitReplyPosted(deps, reply.id, now);
      } else {
        await deps.db
          .update(replies)
          .set({ status: "approved", updatedAt: now })
          .where(and(eq(replies.id, reply.id), eq(replies.status, "sending")));
        await deps.enqueue("reply.send", { replyId: reply.id }, { singletonKey: reply.id });
        log("warn", "reply send not found on YouTube, sending again", { replyId: reply.id });
      }
    } catch (error) {
      if (error instanceof ChannelRevokedError) {
        await failed("channel_revoked");
        continue;
      }
      log("error", "reply send recovery failed", { replyId: reply.id, ...errorFields(error) });
    }
  }
  return stuck.length;
}

// An approved reply with no job behind it (the send job failed for good, or
// queuing it after the approval failed) would wait for ever. After 15 minutes
// without a change it is queued again; a duplicate job is harmless because
// sendReply claims the reply before posting.
export const ORPHANED_AFTER_MS = 15 * 60_000;

export async function requeueOrphanedApproved(deps: EngineDeps): Promise<number> {
  const now = deps.now?.() ?? new Date();
  const orphans = await deps.db
    .update(replies)
    .set({ updatedAt: now })
    .where(and(eq(replies.status, "approved"), lt(replies.updatedAt, new Date(now.getTime() - ORPHANED_AFTER_MS))))
    .returning({ id: replies.id, accountId: replies.accountId });
  for (const { id, accountId } of orphans) {
    await deps.enqueue("reply.send", { replyId: id }, { singletonKey: id });
    log("warn", "approved reply had no send job, queued again", { replyId: id, accountId });
  }
  return orphans.length;
}

async function emitReplyPosted(deps: EngineDeps, replyId: string, now: Date): Promise<void> {
  try {
    const context = await replyContext(deps.db, replyId);
    if (context) await emitEventSafely(deps.db, { accountId: context.accountId, event: "reply_posted", occurredAt: now, context }, kickWith(deps.enqueue));
  } catch (error) {
    log("warn", "reply_posted event failed", { replyId, ...errorFields(error) });
  }
}

async function queueForTomorrow(deps: EngineDeps, replyId: string, now: Date): Promise<void> {
  await deps.db
    .update(replies)
    .set({ status: "queued", queuedForDatePt: pacificDate(nextPacificMidnight(now)), statusReason: "daily_quota", updatedAt: now })
    .where(eq(replies.id, replyId));
}

// Round robin by account, FIFO within an account (SPEC section 7).
export function fairOrder<T extends { accountId: string }>(rows: readonly T[]): T[] {
  const byAccount = new Map<string, T[]>();
  for (const row of rows) byAccount.set(row.accountId, [...(byAccount.get(row.accountId) ?? []), row]);
  const lanes = [...byAccount.values()];
  const out: T[] = [];
  for (let i = 0; out.length < rows.length; i += 1) {
    for (const lane of lanes) if (lane[i]) out.push(lane[i]!);
  }
  return out;
}

// Runs every minute from the engine tick: after the reset, queued replies
// go out first, as many as today's quota allows.
export async function releaseQueued(deps: EngineDeps): Promise<number> {
  const now = deps.now?.() ?? new Date();
  const today = pacificDate(now);
  const waiting = await deps.db
    .select({ id: replies.id, accountId: replies.accountId })
    .from(replies)
    .where(and(eq(replies.status, "queued"), lte(replies.queuedForDatePt, today)))
    .orderBy(asc(replies.approvedAt));
  if (waiting.length === 0) return 0;
  const room = repliesLeftToday(await dayUsage(deps.db, today), deps.quotaLimit);
  const release = fairOrder(waiting).slice(0, room);
  for (const { id } of release) {
    await deps.db.update(replies).set({ status: "approved", queuedForDatePt: null, updatedAt: now }).where(and(eq(replies.id, id), eq(replies.status, "queued")));
    await deps.enqueue("reply.send", { replyId: id }, { singletonKey: id });
  }
  return release.length;
}
