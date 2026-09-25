import { addDays, zonedDay } from "./time";

// Reports (SPEC section 12, DECISIONS Q-08, Q-09, R-35). Pure functions: the
// worker loads first-party rows (src/server/reports.ts), builds every period
// here and stores the result as a snapshot, so dashboards never compute.
// Only real numbers: counts and sums of stored events, nothing estimated.

export const PERIODS = ["this_month", "last_30", "last_90", "all_time"] as const;
export type Period = (typeof PERIODS)[number];

export const PERIOD_LABELS: Record<Period, string> = {
  this_month: "This month",
  last_30: "Last 30 days",
  last_90: "Last 90 days",
  all_time: "All time",
};

// Time from draft to posted reply (R-35: approval speed vs conversion).
export const REPLY_TIME_BUCKETS = [
  { key: "under_1h", label: "Under 1 hour", maxMs: 3_600_000 },
  { key: "1h_6h", label: "1 to 6 hours", maxMs: 6 * 3_600_000 },
  { key: "6h_24h", label: "6 to 24 hours", maxMs: 24 * 3_600_000 },
  { key: "over_24h", label: "Over 24 hours", maxMs: Infinity },
] as const;

// Template key of a reply: the approved template it came from, an AI draft,
// or the built-in fallback. Traffic from static links (description, pinned
// comment) has no reply.
export type TemplateKey = string; // template id | "ai" | "fallback" | "static"
export const STATIC_KEY = "static";

export function templateKeyOf(reply: { draftSource: string; templateId: string | null } | null): TemplateKey {
  if (!reply) return STATIC_KEY;
  if (reply.draftSource === "ai") return "ai";
  return reply.templateId ?? "fallback";
}

interface Dims {
  videoId: string | null;
  keyword: string | null;
  intent: string | null;
  templateKey: TemplateKey;
}

export interface ReplyFact extends Dims {
  id: string;
  createdAt: Date;
  sentAt: Date | null;
}

// Non-bot clicks, pre-aggregated per link and day by SQL.
export interface ClickFact extends Dims {
  replyId: string | null;
  day: string;
  count: number;
}

// Attributed opt-ins (touches traced to a comment).
export interface SubscriberFact extends Dims {
  email: string;
  replyId: string | null;
  occurredAt: Date;
}

// Canonical purchases only (duplicates excluded, Q-05).
export interface PurchaseFact extends Dims {
  buyer: string;
  replyId: string | null;
  attributed: boolean;
  netCents: number | null; // null: buyer marker, revenue not reported
  currency: string | null;
  recurring: boolean;
  occurredAt: Date;
}

export interface ReportInput {
  replies: ReplyFact[];
  clicks: ClickFact[];
  subscribers: SubscriberFact[];
  purchases: PurchaseFact[];
}

export interface Metrics {
  comments: number;
  replies: number;
  clicks: number;
  subscribers: number;
  buyers: number;
  revenueCents: number;
}

export interface Row extends Metrics {
  key: string;
  intent?: string | null;
}

export interface ReplyTimeRow extends Metrics {
  key: string;
  label: string;
}

export interface Report {
  period: Period;
  fromDay: string | null;
  toDay: string;
  currency: string;
  totals: Metrics & {
    recurringCents: number;
    // Buyers whose purchases carry no amount (tag, won opportunity).
    buyersWithoutAmount: number;
    // Attributed net revenue in other currencies; never converted (Q-08).
    otherCurrencies: { currency: string; revenueCents: number }[];
  };
  byVideo: Row[];
  byKeyword: Row[];
  byTemplate: Row[];
  byIntent: Row[];
  byReplyTime: ReplyTimeRow[];
}

export function periodRange(period: Period, now: Date, timeZone: string): { fromDay: string | null; toDay: string } {
  const today = zonedDay(now, timeZone);
  switch (period) {
    case "this_month":
      return { fromDay: `${today.slice(0, 8)}01`, toDay: today };
    case "last_30":
      return { fromDay: addDays(today, -29), toDay: today };
    case "last_90":
      return { fromDay: addDays(today, -89), toDay: today };
    case "all_time":
      return { fromDay: null, toDay: today };
  }
}

const empty = (): Metrics => ({ comments: 0, replies: 0, clicks: 0, subscribers: 0, buyers: 0, revenueCents: 0 });

// Accumulates additive counts and distinct people per group key.
interface GroupRow {
  metrics: Metrics;
  intent?: string | null;
  people: Set<string>;
  buyers: Set<string>;
}

class Groups {
  private rows = new Map<string, GroupRow>();

  private get(key: string, intent?: string | null): GroupRow {
    const found = this.rows.get(key);
    if (found) {
      if (intent != null && found.intent == null) found.intent = intent;
      return found;
    }
    const row: GroupRow = { metrics: empty(), people: new Set(), buyers: new Set() };
    if (intent !== undefined) row.intent = intent;
    this.rows.set(key, row);
    return row;
  }

  add(key: string, intent: string | null | undefined, fn: (row: Metrics, people: Set<string>, buyers: Set<string>) => void) {
    const row = this.get(key, intent);
    fn(row.metrics, row.people, row.buyers);
  }

  result(): Row[] {
    return [...this.rows.entries()]
      .map(([key, row]) => ({
        ...row.metrics,
        ...(row.intent !== undefined ? { intent: row.intent } : {}),
        key,
        subscribers: row.people.size,
        buyers: row.buyers.size,
      }))
      .sort((a, b) => b.revenueCents - a.revenueCents || b.buyers - a.buyers || b.subscribers - a.subscribers || b.clicks - a.clicks || b.comments - a.comments || a.key.localeCompare(b.key));
  }
}

const UNKNOWN = "(none)";

export function buildReport(input: ReportInput, options: { period: Period; now: Date; timeZone: string; currency: string }): Report {
  const { fromDay, toDay } = periodRange(options.period, options.now, options.timeZone);
  const inPeriod = (at: Date | string | null) => {
    if (!at) return false;
    const day = typeof at === "string" ? at : zonedDay(at, options.timeZone);
    return (fromDay === null || day >= fromDay) && day <= toDay;
  };
  const currency = options.currency;

  const byVideo = new Groups();
  const byKeyword = new Groups();
  const byTemplate = new Groups();
  const byIntent = new Groups();
  const all = (d: Dims, fn: (row: Metrics, people: Set<string>, buyers: Set<string>) => void) => {
    byVideo.add(d.videoId ?? UNKNOWN, undefined, fn);
    byKeyword.add(d.keyword ?? UNKNOWN, d.intent, fn);
    byTemplate.add(d.templateKey, d.intent, fn);
    byIntent.add(d.intent ?? UNKNOWN, undefined, fn);
  };

  const totals = empty();
  const totalPeople = new Set<string>();
  const totalBuyers = new Set<string>();
  const buyersWithAmount = new Set<string>();
  let recurringCents = 0;
  const other = new Map<string, number>();

  for (const r of input.replies) {
    if (inPeriod(r.createdAt)) {
      totals.comments += 1;
      all(r, (row) => void (row.comments += 1));
    }
    if (inPeriod(r.sentAt)) {
      totals.replies += 1;
      all(r, (row) => void (row.replies += 1));
    }
  }
  for (const c of input.clicks) {
    if (!inPeriod(c.day)) continue;
    totals.clicks += c.count;
    all(c, (row) => void (row.clicks += c.count));
  }
  for (const s of input.subscribers) {
    if (!inPeriod(s.occurredAt)) continue;
    totalPeople.add(s.email);
    all(s, (_row, people) => void people.add(s.email));
  }
  for (const p of input.purchases) {
    if (!p.attributed || !inPeriod(p.occurredAt)) continue;
    totalBuyers.add(p.buyer);
    if (p.netCents !== null) buyersWithAmount.add(p.buyer);
    const counted = p.netCents !== null && p.currency === currency ? p.netCents : 0;
    if (p.netCents !== null && p.currency && p.currency !== currency) other.set(p.currency, (other.get(p.currency) ?? 0) + p.netCents);
    totals.revenueCents += counted;
    if (p.recurring) recurringCents += counted;
    all(p, (row, _people, buyers) => {
      buyers.add(p.buyer);
      row.revenueCents += counted;
    });
  }
  totals.subscribers = totalPeople.size;
  totals.buyers = totalBuyers.size;

  // Reply speed: replies posted in the period, with everything they led to.
  const bucketOf = (r: ReplyFact) => REPLY_TIME_BUCKETS.find((b) => r.sentAt!.getTime() - r.createdAt.getTime() < b.maxMs)!.key;
  const sentInPeriod = new Map(input.replies.filter((r) => inPeriod(r.sentAt)).map((r) => [r.id, bucketOf(r)]));
  const speed = new Map(REPLY_TIME_BUCKETS.map((b) => [b.key as string, { ...empty(), people: new Set<string>(), buyers: new Set<string>() }]));
  for (const bucket of sentInPeriod.values()) speed.get(bucket)!.replies += 1;
  for (const c of input.clicks) {
    const bucket = c.replyId ? sentInPeriod.get(c.replyId) : undefined;
    if (bucket) speed.get(bucket)!.clicks += c.count;
  }
  for (const s of input.subscribers) {
    const bucket = s.replyId ? sentInPeriod.get(s.replyId) : undefined;
    if (bucket) speed.get(bucket)!.people.add(s.email);
  }
  for (const p of input.purchases) {
    const bucket = p.attributed && p.replyId ? sentInPeriod.get(p.replyId) : undefined;
    if (!bucket) continue;
    const row = speed.get(bucket)!;
    row.buyers.add(p.buyer);
    if (p.netCents !== null && p.currency === currency) row.revenueCents += p.netCents;
  }

  return {
    period: options.period,
    fromDay,
    toDay,
    currency,
    totals: {
      ...totals,
      recurringCents,
      buyersWithoutAmount: [...totalBuyers].filter((b) => !buyersWithAmount.has(b)).length,
      otherCurrencies: [...other.entries()].map(([code, revenueCents]) => ({ currency: code, revenueCents })).sort((a, b) => b.revenueCents - a.revenueCents),
    },
    byVideo: byVideo.result(),
    byKeyword: byKeyword.result(),
    byTemplate: byTemplate.result(),
    byIntent: byIntent.result(),
    byReplyTime: REPLY_TIME_BUCKETS.map((b) => {
      const { people, buyers, ...row } = speed.get(b.key)!;
      return { ...row, key: b.key, label: b.label, subscribers: people.size, buyers: buyers.size };
    }),
  };
}

// The subscription price as a monthly amount in minor units (R-21: the
// founding plan's 97 USD a year shows as 8.08 a month). Null when the plan
// has no price: free grants, internal, enterprise without a set price.
export function monthlyPriceCents(plan: { billing: string; priceCents: number | null }): number | null {
  if (plan.priceCents === null || plan.priceCents <= 0) return null;
  if (plan.billing === "monthly") return plan.priceCents;
  if (plan.billing === "annual") return Math.round(plan.priceCents / 12);
  return null;
}

export interface Headline {
  currency: string;
  thisMonthCents: number;
  lifetimeCents: number;
  recurringThisMonthCents: number;
  recurringLifetimeCents: number;
  // Q-09: the subscription as a share of this month's attributed revenue,
  // and the same as a multiple (R-35 ROI line). Null when it cannot be said
  // honestly: no price, zero revenue, or a different currency (no FX).
  subscriptionMonthlyCents: number | null;
  subscriptionPercent: number | null;
  roiMultiple: number | null;
}

export function buildHeadline(thisMonth: Report, allTime: Report, plan: { billing: string; priceCents: number | null; priceCurrency: string | null }): Headline {
  const monthly = monthlyPriceCents(plan);
  const priced = monthly !== null && plan.priceCurrency === thisMonth.currency ? monthly : null;
  const revenue = thisMonth.totals.revenueCents;
  return {
    currency: thisMonth.currency,
    thisMonthCents: revenue,
    lifetimeCents: allTime.totals.revenueCents,
    recurringThisMonthCents: thisMonth.totals.recurringCents,
    recurringLifetimeCents: allTime.totals.recurringCents,
    subscriptionMonthlyCents: priced,
    subscriptionPercent: priced !== null && revenue > 0 ? (priced / revenue) * 100 : null,
    roiMultiple: priced !== null && revenue > 0 ? revenue / priced : null,
  };
}
