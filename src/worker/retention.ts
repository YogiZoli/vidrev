import { and, eq, inArray, isNotNull, lt, notInArray, or, isNull } from "drizzle-orm";
import { channels, comments, replies, videos } from "@/db/schema";
import { log } from "@/lib/log";
import { reserveUnits } from "@/server/quota";
import { ChannelRevokedError, getAccessToken } from "./channels";
import type { EngineDeps } from "./polling";

// Daily 30-day rule (DECISIONS Q-17 c). YouTube API data is deleted after 30
// days: comment text, commenter names and channel ids, video titles and reply
// ids. Channel titles are refreshed. First-party data (our replies, counts)
// is kept. Channels that are no longer connected lose all YouTube data now.
const RETENTION_MS = 30 * 86_400_000;

export interface RetentionResult {
  comments: number;
  videos: number;
  replyIds: number;
  expiredDrafts: number;
  channelTitles: number;
}

export async function runRetention(deps: EngineDeps): Promise<RetentionResult> {
  const now = deps.now?.() ?? new Date();
  const cutoff = new Date(now.getTime() - RETENTION_MS);
  const db = deps.db;
  const disconnected = db.select({ id: channels.id }).from(channels).where(notInArray(channels.status, ["connecting", "connected"]));

  // Drafts nobody approved within 30 days expire; their comment goes below.
  const expired = await db
    .update(replies)
    .set({ status: "expired", updatedAt: now })
    .where(and(eq(replies.status, "pending_approval"), lt(replies.createdAt, cutoff)))
    .returning({ id: replies.id });
  const deletedComments = await db
    .delete(comments)
    .where(or(lt(comments.fetchedAt, cutoff), inArray(comments.channelId, disconnected)))
    .returning({ id: comments.id });
  const deletedVideos = await db
    .delete(videos)
    .where(or(lt(videos.fetchedAt, cutoff), inArray(videos.channelId, disconnected)))
    .returning({ id: videos.id });
  const wipedReplyIds = await db
    .update(replies)
    .set({ youtubeReplyId: null })
    .where(and(isNotNull(replies.youtubeReplyId), or(lt(replies.sentAt, cutoff), inArray(replies.channelId, disconnected))))
    .returning({ id: replies.id });

  // Channel titles: refresh with channels.list (1 unit), or drop them.
  const stale = await db
    .select()
    .from(channels)
    .where(and(eq(channels.status, "connected"), or(isNull(channels.titleRefreshedAt), lt(channels.titleRefreshedAt, cutoff))));
  let refreshed = 0;
  for (const channel of stale) {
    let title: string | null = null;
    try {
      if (await reserveUnits(db, { method: "channels.list", accountId: channel.accountId, limit: deps.quotaLimit }, now)) {
        const token = await getAccessToken(deps, channel);
        const response = await deps.fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
          headers: { authorization: `Bearer ${token}` },
        });
        if (response.ok) {
          title = ((await response.json()) as { items?: { snippet?: { title?: string } }[] }).items?.[0]?.snippet?.title ?? null;
        }
      }
    } catch (error) {
      if (!(error instanceof ChannelRevokedError)) log("warn", "channel title refresh failed", { channelId: channel.id, error: String(error) });
    }
    await db.update(channels).set({ title, titleRefreshedAt: title ? now : null }).where(eq(channels.id, channel.id));
    if (title) refreshed += 1;
  }

  const result = {
    comments: deletedComments.length,
    videos: deletedVideos.length,
    replyIds: wipedReplyIds.length,
    expiredDrafts: expired.length,
    channelTitles: refreshed,
  };
  log("info", "retention done", { ...result });
  return result;
}
