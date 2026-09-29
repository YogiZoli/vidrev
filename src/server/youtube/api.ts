import type { FetchLike } from "@/server/google/oauth";

// Thin YouTube Data API v3 client. Every call must be preceded by
// reserveUnits() (src/server/quota.ts); these functions never charge.
const API = "https://www.googleapis.com/youtube/v3";

export class YoutubeApiError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string,
    message: string,
  ) {
    super(message);
    this.name = "YoutubeApiError";
  }

  get quotaExceeded(): boolean {
    return this.reason === "quotaExceeded" || this.reason === "rateLimitExceeded" || this.reason === "dailyLimitExceeded";
  }
}

async function call<T>(fetchImpl: FetchLike, token: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetchImpl(`${API}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...(init?.body ? { "content-type": "application/json" } : {}) },
  });
  const json = (await response.json().catch(() => ({}))) as { error?: { message?: string; errors?: { reason?: string }[] } };
  if (!response.ok) {
    const reason = json.error?.errors?.[0]?.reason ?? `http_${response.status}`;
    throw new YoutubeApiError(response.status, reason, json.error?.message ?? `YouTube API ${path.split("?")[0]} failed`);
  }
  return json as T;
}

export interface CommentThread {
  id: string;
  snippet: {
    videoId?: string;
    topLevelComment: {
      id: string;
      snippet: {
        textOriginal?: string;
        textDisplay?: string;
        authorDisplayName?: string;
        authorChannelId?: { value?: string };
        publishedAt: string;
      };
    };
  };
}

// One page of the newest top-level comments across the whole channel
// (allThreadsRelatedToChannelId, 1 unit). Replies inside threads are not
// requested, so they never trigger (Q-19).
export function listChannelThreads(fetchImpl: FetchLike, token: string, youtubeChannelId: string, pageToken?: string) {
  const params = new URLSearchParams({
    part: "snippet",
    allThreadsRelatedToChannelId: youtubeChannelId,
    order: "time",
    maxResults: "100",
    textFormat: "plainText",
  });
  if (pageToken) params.set("pageToken", pageToken);
  return call<{ items?: CommentThread[]; nextPageToken?: string }>(fetchImpl, token, `/commentThreads?${params.toString()}`);
}

export interface VideoItem {
  id: string;
  snippet?: { title?: string; publishedAt?: string };
}

// The channel's newest uploads (playlistItems.list on the uploads playlist,
// 1 unit for up to 50). The uploads playlist id is the channel id with "UU"
// instead of "UC".
export function listUploads(fetchImpl: FetchLike, token: string, youtubeChannelId: string, max = 50) {
  const params = new URLSearchParams({ part: "contentDetails", playlistId: `UU${youtubeChannelId.slice(2)}`, maxResults: String(Math.min(max, 50)) });
  return call<{ items?: { contentDetails?: { videoId?: string; videoPublishedAt?: string } }[] }>(fetchImpl, token, `/playlistItems?${params.toString()}`);
}

export interface VideoStatsItem {
  id: string;
  snippet?: { title?: string; publishedAt?: string; thumbnails?: { default?: { url?: string }; medium?: { url?: string } } };
  statistics?: { viewCount?: string; commentCount?: string };
}

// Title, thumbnail, views and comment count for up to 50 videos, 1 unit.
export function listVideoStats(fetchImpl: FetchLike, token: string, ids: string[]) {
  const params = new URLSearchParams({ part: "snippet,statistics", id: ids.slice(0, 50).join(","), maxResults: "50" });
  return call<{ items?: VideoStatsItem[] }>(fetchImpl, token, `/videos?${params.toString()}`);
}

// Up to 50 ids per call, 1 unit.
export function listVideos(fetchImpl: FetchLike, token: string, ids: string[]) {
  const params = new URLSearchParams({ part: "snippet", id: ids.join(","), maxResults: "50" });
  return call<{ items?: VideoItem[] }>(fetchImpl, token, `/videos?${params.toString()}`);
}

// Replies under one top-level comment (comments.list by parentId, 1 unit).
// Used to confirm whether a send whose outcome is unknown reached YouTube.
export function listReplies(fetchImpl: FetchLike, token: string, parentId: string) {
  const params = new URLSearchParams({ part: "snippet", parentId, textFormat: "plainText", maxResults: "100" });
  return call<{ items?: { id: string; snippet?: { textOriginal?: string; authorChannelId?: { value?: string }; publishedAt?: string } }[] }>(
    fetchImpl,
    token,
    `/comments?${params.toString()}`,
  );
}

// Up to 50 ids per call, 1 unit. Used by the retention job to refresh.
export function listCommentsById(fetchImpl: FetchLike, token: string, ids: string[]) {
  const params = new URLSearchParams({ part: "snippet", id: ids.join(","), textFormat: "plainText", maxResults: "50" });
  return call<{ items?: { id: string; snippet?: { textOriginal?: string; authorChannelId?: { value?: string } } }[] }>(fetchImpl, token, `/comments?${params.toString()}`);
}

// Reply to a top-level comment (comments.insert, 50 units).
export function insertReply(fetchImpl: FetchLike, token: string, parentId: string, text: string) {
  return call<{ id: string }>(fetchImpl, token, "/comments?part=snippet", {
    method: "POST",
    body: JSON.stringify({ snippet: { parentId, textOriginal: text } }),
  });
}

export function commentUrl(youtubeVideoId: string, youtubeCommentId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(youtubeVideoId)}&lc=${encodeURIComponent(youtubeCommentId)}`;
}
