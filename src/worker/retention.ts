import { and, eq, inArray, isNotNull, lt, lte, notInArray, or, isNull } from "drizzle-orm";
import { channels, comments, contactIdentities, replies, videos } from "@/db/schema";
import { YOUTUBE_IDENTITY_TTL_MS } from "@/lib/contacts";
import { errorFields, log } from "@/lib/log";
import { reserveUnits } from "@/server/quota";
import { listCommentsById } from "@/server/youtube/api";
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
  identitiesRefreshed: number;
  identitiesDeleted: number;
}

// Commenter references that recognise a returning commenter (DECISIONS 13.9)
// are confirmed with YouTube this many days before they are due, so a bad day
// (quota, an outage) can be retried before the 30 days run out.
const REFRESH_LEAD_MS = 5 * 86_400_000;
const REFRESH_BATCH = 50;

// Confirms each commenter channel id by asking YouTube for the comment that
// showed it (comments.list by id, 1 unit per up to 50). Still there with the
// same author: kept for 30 more days. Gone or different: deleted. Contacts and
// their first-party history are never touched, only the ability to recognise
// the person by their YouTube channel.
async function refreshCommenterIdentities(deps: EngineDeps, now: Date): Promise<{ refreshed: number; deleted: number }> {
  const db = deps.db;
  let refreshed = 0;
  let deleted = 0;
  const soon = new Date(now.getTime() + REFRESH_LEAD_MS);
  const due = await db
    .select()
    .from(contactIdentities)
    .where(and(eq(contactIdentities.kind, "youtube_channel"), isNotNull(contactIdentities.channelId), lte(contactIdentities.refreshDueAt, soon)));
  const byChannel = new Map<string, typeof due>();
  for (const identity of due) byChannel.set(identity.channelId!, [...(byChannel.get(identity.channelId!) ?? []), identity]);

  for (const [channelId, identities] of byChannel) {
    const [channel] = await db.select().from(channels).where(and(eq(channels.id, channelId), eq(channels.status, "connected")));
    if (!channel) continue;
    let token: string;
    try {
      token = await getAccessToken(deps, channel);
    } catch (error) {
      if (!(error instanceof ChannelRevokedError)) log("warn", "identity refresh: no token", { channelId, ...errorFields(error) });
      continue;
    }
    for (let i = 0; i < identities.length; i += REFRESH_BATCH) {
      const batch = identities.slice(i, i + REFRESH_BATCH);
      const withRef = batch.filter((identity) => identity.refCommentId);
      if (withRef.length === 0) continue;
      if (!(await reserveUnits(db, { method: "comments.list", accountId: channel.accountId, limit: deps.quotaLimit }, now))) break;
      let authors: Map<string, string | undefined>;
      try {
        const response = await listCommentsById(deps.fetch, token, [...new Set(withRef.map((identity) => identity.refCommentId!))]);
        authors = new Map((response.items ?? []).map((item) => [item.id, item.snippet?.authorChannelId?.value]));
      } catch (error) {
        log("warn", "identity refresh failed", { channelId, ...errorFields(error) });
        continue;
      }
      for (const identity of withRef) {
        if (authors.get(identity.refCommentId!) === identity.value) {
          await db
            .update(contactIdentities)
            .set({ refreshDueAt: new Date(now.getTime() + YOUTUBE_IDENTITY_TTL_MS) })
            .where(eq(contactIdentities.id, identity.id));
          refreshed += 1;
        } else {
          await db.delete(contactIdentities).where(eq(contactIdentities.id, identity.id));
          deleted += 1;
        }
      }
    }
  }
  return { refreshed, deleted };
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

  // Commenter references: confirm again or delete (13.9), then drop whatever
  // is past its 30 days, disconnected channels included.
  const refreshedIdentities = await refreshCommenterIdentities(deps, now);
  const expiredIdentities = await db
    .delete(contactIdentities)
    .where(
      and(
        inArray(contactIdentities.kind, ["youtube_channel", "comment"]),
        or(lte(contactIdentities.refreshDueAt, now), inArray(contactIdentities.channelId, disconnected)),
      ),
    )
    .returning({ id: contactIdentities.id });

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
      if (!(error instanceof ChannelRevokedError)) log("warn", "channel title refresh failed", { channelId: channel.id, ...errorFields(error) });
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
    identitiesRefreshed: refreshedIdentities.refreshed,
    identitiesDeleted: refreshedIdentities.deleted + expiredIdentities.length,
  };
  log("info", "retention done", { ...result });
  return result;
}
