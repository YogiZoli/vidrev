import type { FetchLike } from "@/server/google/oauth";
import type { ChannelRef } from "@/lib/audit/handle";

// YouTube Data API v3 with a plain API key from the separate audit project
// (D-34): public data only, no OAuth. Every call must be preceded by
// reserveUnits(..., { gcpProject: "audit" }); these functions never charge.
// The key travels in the query string, so URLs are never logged or put in
// error messages.
const API = "https://www.googleapis.com/youtube/v3";

export class AuditApiError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string,
    message: string,
  ) {
    super(message);
    this.name = "AuditApiError";
  }

  get quotaExceeded(): boolean {
    return this.reason === "quotaExceeded" || this.reason === "rateLimitExceeded" || this.reason === "dailyLimitExceeded";
  }

  get commentsDisabled(): boolean {
    return this.reason === "commentsDisabled";
  }

  get videoGone(): boolean {
    return this.reason === "videoNotFound" || this.reason === "notFound" || this.status === 404;
  }
}

async function call<T>(fetchImpl: FetchLike, apiKey: string, path: string, params: Record<string, string>): Promise<T> {
  const query = new URLSearchParams({ ...params, key: apiKey });
  const response = await fetchImpl(`${API}${path}?${query.toString()}`, { headers: { accept: "application/json" } });
  const json = (await response.json().catch(() => ({}))) as { error?: { message?: string; errors?: { reason?: string }[] } };
  if (!response.ok) {
    const reason = json.error?.errors?.[0]?.reason ?? `http_${response.status}`;
    throw new AuditApiError(response.status, reason, `YouTube API ${path} failed (${reason})`);
  }
  return json as T;
}

export interface AuditChannel {
  id: string;
  title: string | null;
  description: string;
  uploadsPlaylistId: string | null;
}

interface ChannelsResponse {
  items?: { id: string; snippet?: { title?: string; description?: string }; contentDetails?: { relatedPlaylists?: { uploads?: string } } }[];
}

// channels.list, 1 unit.
export async function findChannel(fetchImpl: FetchLike, apiKey: string, ref: ChannelRef): Promise<AuditChannel | null> {
  const params: Record<string, string> = { part: "snippet,contentDetails" };
  if (ref.kind === "handle") params.forHandle = ref.handle;
  else if (ref.kind === "id") params.id = ref.id;
  else params.forUsername = ref.username;
  const response = await call<ChannelsResponse>(fetchImpl, apiKey, "/channels", params);
  const item = response.items?.[0];
  if (!item) return null;
  return {
    id: item.id,
    title: item.snippet?.title ?? null,
    description: item.snippet?.description ?? "",
    uploadsPlaylistId: item.contentDetails?.relatedPlaylists?.uploads ?? null,
  };
}

// playlistItems.list, 1 unit: the newest uploads first.
export async function latestUploadIds(fetchImpl: FetchLike, apiKey: string, playlistId: string, count: number): Promise<string[]> {
  const response = await call<{ items?: { contentDetails?: { videoId?: string } }[] }>(fetchImpl, apiKey, "/playlistItems", {
    part: "contentDetails",
    playlistId,
    maxResults: String(count),
  });
  return (response.items ?? []).map((i) => i.contentDetails?.videoId).filter((id): id is string => Boolean(id));
}

export interface AuditVideo {
  id: string;
  title: string;
  description: string;
}

// videos.list, 1 unit for up to 50 ids.
export async function videoDetails(fetchImpl: FetchLike, apiKey: string, ids: string[]): Promise<AuditVideo[]> {
  const response = await call<{ items?: { id: string; snippet?: { title?: string; description?: string } }[] }>(fetchImpl, apiKey, "/videos", {
    part: "snippet",
    id: ids.join(","),
    maxResults: "50",
  });
  const byId = new Map((response.items ?? []).map((i) => [i.id, i]));
  return ids.flatMap((id) => {
    const item = byId.get(id);
    return item ? [{ id, title: item.snippet?.title ?? "", description: item.snippet?.description ?? "" }] : [];
  });
}

export interface RawThread {
  id: string;
  snippet: {
    totalReplyCount?: number;
    topLevelComment?: { snippet?: { textDisplay?: string; textOriginal?: string; authorChannelId?: { value?: string } } };
  };
  replies?: { comments?: { snippet?: { authorChannelId?: { value?: string } } }[] };
}

// commentThreads.list for one video, 1 unit per page of 100 newest top-level
// comments, with the replies YouTube includes (at most 5 per thread).
export function videoThreads(fetchImpl: FetchLike, apiKey: string, videoId: string, pageToken?: string) {
  const params: Record<string, string> = { part: "snippet,replies", videoId, order: "time", maxResults: "100", textFormat: "plainText" };
  if (pageToken) params.pageToken = pageToken;
  return call<{ items?: RawThread[]; nextPageToken?: string }>(fetchImpl, apiKey, "/commentThreads", params);
}
