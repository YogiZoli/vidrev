// Quota budget for the shared app GCP project (D-27, D-31, D-31b, Q-02).
// One Pacific-time day has QUOTA_DAILY_LIMIT units for ALL customers. The
// reply reserve (default 75%) is kept for comments.insert; polling and other
// reads may use only the rest. Replies may use whatever is left of the day.

export const UNIT_COSTS = {
  "commentThreads.list": 1,
  "comments.list": 1,
  "channels.list": 1,
  "playlistItems.list": 1,
  "videos.list": 1,
  "comments.insert": 50,
} as const;

export type QuotaMethod = keyof typeof UNIT_COSTS;

export const REPLY_METHOD: QuotaMethod = "comments.insert";

export interface DayUsage {
  // Units already spent today on reads (everything except comments.insert).
  reads: number;
  // Units already spent today on replies.
  replies: number;
}

export function readBudget(limit: number, reservePct: number): number {
  return Math.floor(limit * (1 - reservePct / 100));
}

export function canSpendOnRead(usage: DayUsage, limit: number, reservePct: number, units = 1): boolean {
  return usage.reads + units <= readBudget(limit, reservePct) && usage.reads + usage.replies + units <= limit;
}

export function canSpendOnReply(usage: DayUsage, limit: number): boolean {
  return usage.reads + usage.replies + UNIT_COSTS[REPLY_METHOD] <= limit;
}

// Replies that still fit into the rest of today.
export function repliesLeftToday(usage: DayUsage, limit: number): number {
  return Math.max(0, Math.floor((limit - usage.reads - usage.replies) / UNIT_COSTS[REPLY_METHOD]));
}

// Activity tiers (D-27): a video published in the last 48h polls every 2
// minutes, a channel without an upload in 14 days every 60, the rest every 15.
export const TIER_MINUTES = { fresh: 2, normal: 15, quiet: 60 } as const;
export type PollTier = keyof typeof TIER_MINUTES;

const DAY_MS = 86_400_000;

export function pollTier(channel: { freshUntil: Date | null; lastUploadAt: Date | null }, now: Date): PollTier {
  if (channel.freshUntil && channel.freshUntil > now) return "fresh";
  if (channel.lastUploadAt && now.getTime() - channel.lastUploadAt.getTime() > 14 * DAY_MS) return "quiet";
  return "normal";
}

// Tier intervals are targets. When all active channels together would need
// more polls per day than the read budget allows (keeping 20% headroom for
// extra pages and retention refreshes), one global factor stretches them all.
// Capped so even an empty budget polls a normal channel once a day.
export const MAX_STRETCH = 96;

export function stretchFactor(tiers: readonly PollTier[], budget: number): number {
  const pollsPerDay = tiers.reduce((sum, tier) => sum + 1440 / TIER_MINUTES[tier], 0);
  const usable = budget * 0.8;
  if (usable <= 0) return MAX_STRETCH;
  return Math.min(MAX_STRETCH, Math.max(1, pollsPerDay / usable));
}

// FAST_POLL_ACCOUNTS (owner testing): every minute, never stretched.
export const FAST_POLL_MS = 60_000;

export function nextPollAt(tier: PollTier, factor: number, now: Date): Date {
  return new Date(now.getTime() + TIER_MINUTES[tier] * factor * 60_000);
}
