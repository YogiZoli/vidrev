import { desc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { channels, videos } from "@/db/schema";
import { errorFields, log } from "@/lib/log";
import { reserveUnits } from "@/server/quota";
import { listUploads, listVideoStats } from "@/server/youtube/api";
import { type ChannelDeps, getAccessToken } from "@/worker/channels";

export interface PickableVideo {
  youtubeVideoId: string;
  title: string | null;
  publishedAt: Date | null;
  thumbnail: string | null;
  views: number | null;
  comments: number | null;
}

export interface VideoList {
  videos: PickableVideo[];
  // "youtube": fresh from the API with views and comments; "known": only the
  // videos we already know (the API could not be asked), without numbers.
  source: "youtube" | "known";
}

// A list costs 2 units (uploads + stats); the page is opened often, the
// channel changes rarely, so one list is kept for 10 minutes per channel.
const CACHE_MS = 10 * 60_000;
const cache = new Map<string, { at: number; list: VideoList }>();

export function clearVideoCache(): void {
  cache.clear();
}

function toNumber(value: string | undefined): number | null {
  if (value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Videos for the "Which videos?" step: the channel's newest 50 uploads with
// views and comment counts from the YouTube API. When the API cannot be asked
// (quota, revoked grant, network), the videos we already know are shown and
// the reason is logged.
export async function pickableVideos(
  db: Db,
  channelId: string,
  deps: (ChannelDeps & { quotaLimit: number }) | null,
  now = new Date(),
): Promise<VideoList> {
  const hit = cache.get(channelId);
  if (hit && now.getTime() - hit.at < CACHE_MS) return hit.list;

  const [channel] = await db.select().from(channels).where(eq(channels.id, channelId));
  if (channel?.youtubeChannelId && channel.status === "connected" && deps) {
    try {
      const reserved =
        (await reserveUnits(db, { method: "playlistItems.list", accountId: channel.accountId, limit: deps.quotaLimit }, now)) &&
        (await reserveUnits(db, { method: "videos.list", accountId: channel.accountId, limit: deps.quotaLimit }, now));
      if (!reserved) throw new Error("daily read budget used up");
      const token = await getAccessToken(deps, channel);
      const ids = ((await listUploads(deps.fetch, token, channel.youtubeChannelId)).items ?? [])
        .map((item) => item.contentDetails?.videoId)
        .filter((id): id is string => Boolean(id));
      const stats = ids.length ? ((await listVideoStats(deps.fetch, token, ids)).items ?? []) : [];
      const byId = new Map(stats.map((item) => [item.id, item]));
      const list: VideoList = {
        source: "youtube",
        videos: ids.map((id) => {
          const item = byId.get(id);
          return {
            youtubeVideoId: id,
            title: item?.snippet?.title ?? null,
            publishedAt: item?.snippet?.publishedAt ? new Date(item.snippet.publishedAt) : null,
            thumbnail: item?.snippet?.thumbnails?.medium?.url ?? item?.snippet?.thumbnails?.default?.url ?? null,
            views: toNumber(item?.statistics?.viewCount),
            comments: toNumber(item?.statistics?.commentCount),
          };
        }),
      };
      cache.set(channelId, { at: now.getTime(), list });
      return list;
    } catch (error) {
      log("warn", "video list from YouTube failed, showing known videos", { channelId, ...errorFields(error) });
    }
  }

  const known = await db
    .select({ youtubeVideoId: videos.youtubeVideoId, title: videos.title, publishedAt: videos.publishedAt })
    .from(videos)
    .where(eq(videos.channelId, channelId))
    .orderBy(desc(videos.publishedAt))
    .limit(50);
  return { source: "known", videos: known.map((v) => ({ ...v, thumbnail: null, views: null, comments: null })) };
}
