import { and, asc, eq, exists, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { accounts, campaigns, channels, comments, videos } from "@/db/schema";
import type { JobPayloads } from "@/jobs/queues";
import { matchComment } from "@/lib/keywords";
import { log } from "@/lib/log";
import { nextPollAt, pollTier, readBudget, stretchFactor } from "@/lib/quota";
import { reserveUnits } from "@/server/quota";
import { getNumberSetting } from "@/server/settings";
import { type CommentThread, listChannelThreads, listVideos, YoutubeApiError } from "@/server/youtube/api";
import { applyFeedEntries } from "@/server/uploads";
import { feedTopic, HUB_URL, LEASE_SECONDS, parseFeed, rssUrl, websubSecret } from "@/server/youtube/feed";
import { releaseQueued } from "./sending";
import { ChannelRevokedError, type ChannelDeps, getAccessToken } from "./channels";

export type Enqueue = <Q extends keyof JobPayloads>(queue: Q, data: JobPayloads[Q], options?: { singletonKey?: string; startAfter?: number }) => Promise<void>;

export interface EngineDeps extends ChannelDeps {
  quotaLimit: number;
  enqueue: Enqueue;
}

// Bounds one poll: 5 pages of 100 comments. A channel that gets more new
// comments between two polls than that loses the oldest ones (logged).
const MAX_PAGES = 5;
const RSS_INTERVAL_MS = 15 * 60_000;

type ChannelRow = typeof channels.$inferSelect;

// A channel is polled only when it is connected, its account is active and
// onboarded (Phase 14) and it has at least one enabled campaign (DECISIONS Q-02).
function activeCondition() {
  return and(
    eq(channels.status, "connected"),
    exists(
      sql`(select 1 from ${accounts} where ${accounts.id} = ${channels.accountId} and ${accounts.status} = 'active' and ${accounts.onboardedAt} is not null)`,
    ),
    exists(
      sql`(select 1 from ${campaigns} where ${campaigns.channelId} = ${channels.id} and ${campaigns.active} = true)`,
    ),
  );
}

export async function activeChannels(db: Db): Promise<ChannelRow[]> {
  return db.select().from(channels).where(activeCondition());
}

async function currentStretch(db: Db, quotaLimit: number, now: Date): Promise<number> {
  const rows = await db
    .select({ freshUntil: channels.freshUntil, lastUploadAt: channels.lastUploadAt })
    .from(channels)
    .where(activeCondition());
  const budget = readBudget(quotaLimit, await getNumberSetting(db, "reply_reserve_pct"));
  return stretchFactor(
    rows.map((row) => pollTier(row, now)),
    budget,
  );
}

// Runs every minute: queues due polls and RSS checks. Jobs are keyed per
// channel, so a slow poll is never queued twice.
export async function engineTick(deps: EngineDeps): Promise<void> {
  const now = deps.now?.() ?? new Date();
  await releaseQueued(deps);
  const rows = await activeChannels(deps.db);
  for (const channel of rows) {
    if (!channel.nextPollAt || channel.nextPollAt <= now) {
      await deps.enqueue("channel.poll", { channelId: channel.id }, { singletonKey: channel.id });
    }
    const websubLive = channel.websubExpiresAt !== null && channel.websubExpiresAt > now;
    const rssDue = !channel.rssCheckedAt || (!websubLive && now.getTime() - channel.rssCheckedAt.getTime() >= RSS_INTERVAL_MS);
    if (rssDue) await deps.enqueue("channel.rss", { channelId: channel.id }, { singletonKey: channel.id });
  }
}

// RSS fallback: the public feed costs no quota. Checked once on activation
// (to learn the last upload) and every 15 minutes while no push lease is live.
export async function checkRss(deps: EngineDeps, channelId: string): Promise<void> {
  const now = deps.now?.() ?? new Date();
  const [channel] = await deps.db.select().from(channels).where(eq(channels.id, channelId));
  if (!channel?.youtubeChannelId || channel.status !== "connected") return;
  const [account] = await deps.db.select({ onboardedAt: accounts.onboardedAt }).from(accounts).where(eq(accounts.id, channel.accountId));
  if (!account?.onboardedAt) return;
  const response = await deps.fetch(rssUrl(channel.youtubeChannelId));
  await deps.db.update(channels).set({ rssCheckedAt: now }).where(eq(channels.id, channel.id));
  if (!response.ok) {
    log("warn", "rss feed failed", { channelId, status: response.status });
    return;
  }
  await applyFeedEntries(deps.db, channel, parseFeed(await response.text()), now);
}

// (Re)subscribes active channels whose push lease is missing or ends within
// two days. The hub confirms asynchronously through GET /api/websub.
export async function renewWebsub(deps: EngineDeps, config: { secret: string; callbackBase: string }): Promise<void> {
  const soon = new Date((deps.now?.() ?? new Date()).getTime() + 2 * 86_400_000);
  const rows = await deps.db
    .select()
    .from(channels)
    .where(and(activeCondition(), or(isNull(channels.websubExpiresAt), lt(channels.websubExpiresAt, soon))));
  for (const channel of rows) {
    if (!channel.youtubeChannelId) continue;
    const response = await deps.fetch(HUB_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        "hub.callback": `${config.callbackBase}/api/websub?c=${channel.id}`,
        "hub.topic": feedTopic(channel.youtubeChannelId),
        "hub.mode": "subscribe",
        "hub.verify": "async",
        "hub.secret": websubSecret(config.secret, channel.id),
        "hub.lease_seconds": String(LEASE_SECONDS),
      }).toString(),
    });
    if (!response.ok) log("warn", "websub subscribe failed", { channelId: channel.id, status: response.status });
  }
}

function threadTime(thread: CommentThread): Date {
  return new Date(thread.snippet.topLevelComment.snippet.publishedAt);
}

// One channel-level poll (commentThreads.list with allThreadsRelatedToChannelId,
// 1 unit per page, never per video). New keyword comments are stored and
// queued for drafting; everything else is dropped without being stored.
export async function pollChannel(deps: EngineDeps, channelId: string): Promise<void> {
  const now = deps.now?.() ?? new Date();
  const [channel] = await deps.db.select().from(channels).where(eq(channels.id, channelId));
  if (!channel?.youtubeChannelId || channel.status !== "connected") return;
  const [account] = await deps.db.select({ onboardedAt: accounts.onboardedAt }).from(accounts).where(eq(accounts.id, channel.accountId));
  if (!account?.onboardedAt) return;
  const channelCampaigns = await deps.db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.channelId, channel.id), eq(campaigns.active, true)))
    .orderBy(asc(campaigns.createdAt));
  if (channelCampaigns.length === 0) return;

  const factor = await currentStretch(deps.db, deps.quotaLimit, now);
  const schedule = async (values: Partial<typeof channels.$inferInsert>) => {
    await deps.db
      .update(channels)
      .set({ nextPollAt: nextPollAt(pollTier(channel, now), factor, now), ...values })
      .where(eq(channels.id, channel.id));
  };

  let token: string;
  try {
    token = await getAccessToken(deps, channel);
  } catch (error) {
    if (error instanceof ChannelRevokedError) return;
    throw error;
  }

  // Comments older than the first enabled campaign are never drafted.
  const cursor = channel.commentCursor ?? channelCampaigns[0]!.createdAt;
  const fresh: CommentThread[] = [];
  let pageToken: string | undefined;
  let reachedCursor = false;
  // Why the pages stopped before the cursor, if they did.
  let stoppedBy: "read_budget" | "youtube_refused" | null = null;
  for (let page = 0; page < MAX_PAGES && !reachedCursor; page += 1) {
    if (!(await reserveUnits(deps.db, { method: "commentThreads.list", accountId: channel.accountId, limit: deps.quotaLimit }, now))) {
      log("warn", "poll stopped: read budget used up", { channelId, page });
      stoppedBy = "read_budget";
      break;
    }
    let result: Awaited<ReturnType<typeof listChannelThreads>>;
    try {
      result = await listChannelThreads(deps.fetch, token, channel.youtubeChannelId, pageToken);
    } catch (error) {
      if (error instanceof YoutubeApiError && (error.quotaExceeded || error.status === 403)) {
        log("warn", "poll refused by YouTube", { channelId, page, status: error.status, reason: error.reason });
        stoppedBy = "youtube_refused";
        break;
      }
      throw error;
    }
    for (const thread of result.items ?? []) {
      if (threadTime(thread) <= cursor) {
        reachedCursor = true;
        break;
      }
      fresh.push(thread);
    }
    pageToken = result.nextPageToken;
    if (!pageToken) reachedCursor = true;
  }
  // Stopped by budget or refusal: the unread pages are read next time, so
  // the cursor stays (stored comments are deduplicated by their YouTube id).
  // Stopped by the page limit: the oldest new comments are given up, logged.
  const keepCursor = !reachedCursor && stoppedBy !== null;
  if (!reachedCursor && stoppedBy === null && fresh.length > 0) {
    log("warn", "poll page limit reached, oldest new comments skipped", { channelId, pages: MAX_PAGES, read: fresh.length });
  }

  const matchable = channelCampaigns.map((c) => ({ ...c, aliases: c.aliases ?? [] }));
  const newVideoIds = new Set<string>();
  for (const thread of fresh.reverse()) {
    const top = thread.snippet.topLevelComment;
    const videoId = thread.snippet.videoId;
    if (!videoId) continue;
    // The creator's own comments never trigger.
    if (top.snippet.authorChannelId?.value === channel.youtubeChannelId) continue;
    const text = top.snippet.textOriginal ?? top.snippet.textDisplay ?? "";
    if (matchComment({ text, videoId, publishedAt: threadTime(thread) }, matchable).length === 0) continue;
    const [inserted] = await deps.db
      .insert(comments)
      .values({
        channelId: channel.id,
        youtubeCommentId: top.id,
        youtubeVideoId: videoId,
        authorChannelId: top.snippet.authorChannelId?.value ?? null,
        authorName: top.snippet.authorDisplayName ?? null,
        text,
        publishedAt: threadTime(thread),
        fetchedAt: now,
      })
      .onConflictDoNothing({ target: comments.youtubeCommentId })
      .returning({ id: comments.id });
    if (!inserted) continue;
    newVideoIds.add(videoId);
    await deps.enqueue("reply.draft", { commentId: inserted.id });
  }

  await learnVideos(deps, channel, token, [...newVideoIds], now);
  const newest = keepCursor ? cursor : fresh.reduce((max, thread) => (threadTime(thread) > max ? threadTime(thread) : max), cursor);
  await schedule({ lastPolledAt: now, commentCursor: newest });
  if (fresh.length > 0 || stoppedBy) log("info", "poll done", { channelId, read: fresh.length, stoppedBy, cursorKept: keepCursor });
}

// Titles for the approval queue, 1 unit per 50 videos, only for videos with a
// new keyword comment that are not known yet (push and RSS fill most).
async function learnVideos(deps: EngineDeps, channel: ChannelRow, token: string, ids: string[], now: Date): Promise<void> {
  if (ids.length === 0) return;
  const known = await deps.db
    .select({ id: videos.youtubeVideoId })
    .from(videos)
    .where(and(eq(videos.channelId, channel.id), inArray(videos.youtubeVideoId, ids)));
  const missing = ids.filter((id) => !known.some((row) => row.id === id)).slice(0, 50);
  if (missing.length === 0) return;
  if (!(await reserveUnits(deps.db, { method: "videos.list", accountId: channel.accountId, limit: deps.quotaLimit }, now))) return;
  const result = await listVideos(deps.fetch, token, missing).catch((error: unknown) => {
    log("warn", "videos.list failed", { channelId: channel.id, error: String(error) });
    return { items: [] };
  });
  for (const item of result.items ?? []) {
    await deps.db
      .insert(videos)
      .values({
        channelId: channel.id,
        youtubeVideoId: item.id,
        title: item.snippet?.title ?? null,
        publishedAt: item.snippet?.publishedAt ? new Date(item.snippet.publishedAt) : null,
        fetchedAt: now,
      })
      .onConflictDoNothing();
  }
}
