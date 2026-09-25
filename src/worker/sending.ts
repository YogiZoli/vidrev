import { and, asc, eq, lte } from "drizzle-orm";
import { campaigns, channels, comments, replies } from "@/db/schema";
import { fallbackHost } from "@/lib/link-host";
import { log } from "@/lib/log";
import { repliesLeftToday } from "@/lib/quota";
import { renderReply } from "@/lib/templates";
import { nextPacificMidnight, pacificDate } from "@/lib/time";
import { replyContext } from "@/server/integrations/context";
import { emitEventSafely, kickWith } from "@/server/integrations/events";
import { ensureReplyLink, publishLink } from "@/server/links";
import { dayUsage, reserveUnits } from "@/server/quota";
import { insertReply, YoutubeApiError } from "@/server/youtube/api";
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

  try {
    const token = await getAccessToken(deps, channel);
    // The tracked link on the creator's domain; the destination URL only
    // while no link host is configured at all.
    const link = await ensureReplyLink(deps.db, reply.id, { fallbackHost: fallbackHost() }, now);
    const posted = await insertReply(deps.fetch, token, comment.youtubeCommentId, renderReply(reply.body, link?.url ?? campaign.destinationUrl));
    if (link) await publishLink(deps.db, link.id, now);
    await deps.db
      .update(replies)
      .set({ status: "sent", sentAt: now, youtubeReplyId: posted.id, statusReason: null, queuedForDatePt: null, updatedAt: now })
      .where(eq(replies.id, reply.id));
    log("info", "reply sent", { replyId: reply.id });
    await emitReplyPosted(deps, reply.id, now);
  } catch (error) {
    if (error instanceof ChannelRevokedError) return void (await fail("channel_revoked"));
    if (error instanceof YoutubeApiError && error.quotaExceeded) {
      await queueForTomorrow(deps, reply.id, now);
      return;
    }
    // Policy and permission errors never fix themselves: no retry.
    if (error instanceof YoutubeApiError && error.status >= 400 && error.status < 500) {
      log("warn", "reply refused by YouTube", { replyId: reply.id, reason: error.reason });
      return void (await fail(error.reason));
    }
    // Transient: back to approved, pg-boss retries with backoff.
    await deps.db.update(replies).set({ status: "approved", updatedAt: now }).where(eq(replies.id, reply.id));
    throw error;
  }
}

async function emitReplyPosted(deps: EngineDeps, replyId: string, now: Date): Promise<void> {
  try {
    const context = await replyContext(deps.db, replyId);
    if (context) await emitEventSafely(deps.db, { accountId: context.accountId, event: "reply_posted", occurredAt: now, context }, kickWith(deps.enqueue));
  } catch (error) {
    log("warn", "reply_posted event failed", { replyId, error: String(error) });
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
