import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { channels, videos } from "@/db/schema";
import { log } from "@/lib/log";
import { FRESH_WINDOW_MS, type FeedEntry } from "@/server/youtube/feed";

type ChannelRow = typeof channels.$inferSelect;

// Stores upload times and titles from a push notification or the RSS feed.
// A new upload in the last 48h switches the channel to the 2-minute tier and
// polls it right away (D-27). Title edits on old videos change nothing.
export async function applyFeedEntries(db: Db, channel: ChannelRow, entries: FeedEntry[], now: Date): Promise<boolean> {
  const own = entries.filter((entry) => entry.channelId === channel.youtubeChannelId);
  for (const entry of own) {
    await db
      .insert(videos)
      .values({ channelId: channel.id, youtubeVideoId: entry.videoId, title: entry.title, publishedAt: entry.published, fetchedAt: now })
      .onConflictDoUpdate({
        target: [videos.channelId, videos.youtubeVideoId],
        set: { title: entry.title, publishedAt: entry.published, fetchedAt: now },
      });
  }
  const newest = own.reduce<Date | null>((max, entry) => (entry.published && (!max || entry.published > max) ? entry.published : max), null);
  if (!newest || (channel.lastUploadAt && newest <= channel.lastUploadAt)) return false;
  const fresh = now.getTime() - newest.getTime() < FRESH_WINDOW_MS;
  await db
    .update(channels)
    .set({
      lastUploadAt: newest,
      ...(fresh ? { freshUntil: new Date(newest.getTime() + FRESH_WINDOW_MS), nextPollAt: now } : {}),
    })
    .where(eq(channels.id, channel.id));
  if (fresh) log("info", "new upload detected", { channelId: channel.id });
  return fresh;
}
