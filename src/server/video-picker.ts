import { desc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { videos } from "@/db/schema";
import { log } from "@/lib/log";
import { parseFeed, rssUrl } from "@/server/youtube/feed";

export interface PickableVideo {
  youtubeVideoId: string;
  title: string | null;
  publishedAt: Date | null;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

// Videos for the campaign picker: the channel's public feed (latest uploads,
// no API quota) merged with the videos we already know, newest first. The
// feed is read, not stored; a slow or failed feed leaves the known ones.
export async function pickableVideos(
  db: Db,
  channel: { id: string; youtubeChannelId: string | null },
  fetchImpl: FetchLike = fetch,
  limit = 30,
): Promise<PickableVideo[]> {
  const known = await db
    .select({ youtubeVideoId: videos.youtubeVideoId, title: videos.title, publishedAt: videos.publishedAt })
    .from(videos)
    .where(eq(videos.channelId, channel.id))
    .orderBy(desc(videos.publishedAt))
    .limit(limit);
  let feed: PickableVideo[] = [];
  if (channel.youtubeChannelId) {
    try {
      const response = await fetchImpl(rssUrl(channel.youtubeChannelId), { signal: AbortSignal.timeout(4000) });
      if (response.ok) {
        feed = parseFeed(await response.text())
          .filter((entry) => entry.channelId === channel.youtubeChannelId)
          .map((entry) => ({ youtubeVideoId: entry.videoId, title: entry.title, publishedAt: entry.published }));
      }
    } catch (error) {
      log("warn", "video picker feed failed", { channelId: channel.id, error: String(error) });
    }
  }
  const byId = new Map<string, PickableVideo>();
  for (const video of [...feed, ...known]) if (!byId.has(video.youtubeVideoId)) byId.set(video.youtubeVideoId, video);
  return [...byId.values()]
    .sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0))
    .slice(0, limit);
}
