import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { accounts, campaigns, channels, clicks, links, purchases, replies, reportSnapshots, subscribers, templates, videos } from "@/db/schema";
import { buildReport, type Period, PERIODS, type Report, type ReportInput, STATIC_KEY, templateKeyOf } from "@/lib/report";

// Builds and stores the report snapshots of one account (Phase 7). Reads only
// first-party rows; the heavy part (attribution) is already on the purchase
// rows. Scale note: everything of one account is read at once, which is fine
// for the founding cohort; clicks are pre-aggregated per link and day in SQL.

const SENT: ("sent" | "sent_manually")[] = ["sent", "sent_manually"];

async function loadInput(db: Db, accountId: string, timeZone: string): Promise<ReportInput> {
  const replyRows = await db
    .select({ id: replies.id, youtubeVideoId: replies.youtubeVideoId, keyword: replies.keyword, intent: replies.intent, draftSource: replies.draftSource, templateId: replies.templateId, status: replies.status, createdAt: replies.createdAt, sentAt: replies.sentAt })
    .from(replies)
    .where(eq(replies.accountId, accountId));
  const replyById = new Map(replyRows.map((r) => [r.id, r]));
  const keyOfReply = (id: string | null) => templateKeyOf(id ? (replyById.get(id) ?? null) : null);

  const clickRows = await db
    .select({
      replyId: clicks.replyId,
      videoId: clicks.youtubeVideoId,
      keyword: clicks.keyword,
      intent: links.intent,
      day: sql<string>`to_char(${clicks.createdAt} at time zone ${timeZone}, 'YYYY-MM-DD')`,
      count: sql<number>`count(*)::int`,
    })
    .from(clicks)
    .innerJoin(links, eq(links.id, clicks.linkId))
    .where(and(eq(clicks.accountId, accountId), eq(clicks.isBot, false)))
    // By position: the day expression carries a bound parameter, which Postgres
    // would not see as the same expression a second time.
    .groupBy(clicks.replyId, clicks.youtubeVideoId, clicks.keyword, links.intent, sql.raw("5"));

  const subscriberRows = await db
    .select({ s: subscribers, campaignIntent: campaigns.intent })
    .from(subscribers)
    .leftJoin(campaigns, eq(campaigns.id, subscribers.campaignId))
    .where(and(eq(subscribers.accountId, accountId), isNotNull(subscribers.keyword)));

  const purchaseRows = await db
    .select()
    .from(purchases)
    // Canonical rows only: a duplicate of the same sale never counts twice.
    .where(and(eq(purchases.accountId, accountId), sql`${purchases.canonicalPurchaseId} = ${purchases.id}`));

  return {
    replies: replyRows.map((r) => ({
      id: r.id,
      videoId: r.youtubeVideoId,
      keyword: r.keyword,
      intent: r.intent,
      templateKey: templateKeyOf(r),
      createdAt: r.createdAt,
      sentAt: SENT.includes(r.status as (typeof SENT)[number]) ? r.sentAt : null,
    })),
    clicks: clickRows.map((c) => ({
      replyId: c.replyId,
      videoId: c.videoId,
      keyword: c.keyword,
      intent: c.intent ?? (c.replyId ? (replyById.get(c.replyId)?.intent ?? null) : null),
      templateKey: keyOfReply(c.replyId),
      day: c.day,
      count: Number(c.count),
    })),
    subscribers: subscriberRows.map(({ s, campaignIntent }) => ({
      email: s.emailNorm,
      replyId: s.replyId,
      videoId: s.youtubeVideoId,
      keyword: s.keyword,
      intent: (s.replyId ? replyById.get(s.replyId)?.intent : null) ?? campaignIntent ?? null,
      templateKey: keyOfReply(s.replyId),
      occurredAt: s.occurredAt,
    })),
    purchases: purchaseRows.map((p) => ({
      buyer: p.emailNorm ?? p.tid ?? p.id,
      replyId: p.attributedReplyId,
      attributed: p.attributionMethod !== null,
      netCents: p.netCents,
      currency: p.currency,
      recurring: p.subscriptionRef !== null || p.attributionMethod === "subscription",
      occurredAt: p.occurredAt,
      videoId: p.attributedVideoId,
      keyword: p.attributedKeyword,
      intent: p.attributedIntent,
      templateKey: p.attributedReplyId ? keyOfReply(p.attributedReplyId) : STATIC_KEY,
    })),
  };
}

// Q-08: without a choice by the creator, the reporting currency follows the
// connected revenue source (the latest paid purchase from a CRM or Stripe).
async function followSourceCurrency(db: Db, account: typeof accounts.$inferSelect): Promise<string> {
  if (account.reportingCurrencySource === "creator") return account.reportingCurrency;
  const [latest] = await db
    .select({ currency: purchases.currency })
    .from(purchases)
    .where(and(eq(purchases.accountId, account.id), inArray(purchases.source, ["ghl", "stripe"]), eq(purchases.kind, "payment"), isNotNull(purchases.currency)))
    .orderBy(desc(purchases.occurredAt))
    .limit(1);
  if (!latest?.currency || latest.currency === account.reportingCurrency) return account.reportingCurrency;
  await db.update(accounts).set({ reportingCurrency: latest.currency, reportingCurrencySource: "source" }).where(eq(accounts.id, account.id));
  return latest.currency;
}

export async function rebuildReports(db: Db, accountId: string, now = new Date()): Promise<Record<Period, Report> | null> {
  const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId));
  if (!account) return null;
  const currency = await followSourceCurrency(db, account);
  const input = await loadInput(db, accountId, account.reportTimezone);
  const reports = Object.fromEntries(PERIODS.map((period) => [period, buildReport(input, { period, now, timeZone: account.reportTimezone, currency })])) as Record<Period, Report>;
  await db.transaction(async (tx) => {
    for (const period of PERIODS) {
      await tx
        .insert(reportSnapshots)
        .values({ accountId, period, data: reports[period], computedAt: now })
        .onConflictDoUpdate({ target: [reportSnapshots.accountId, reportSnapshots.period], set: { data: reports[period], computedAt: now } });
    }
  });
  return reports;
}

export async function readSnapshots(db: Db, accountId: string): Promise<{ reports: Partial<Record<Period, Report>>; computedAt: Date | null }> {
  const rows = await db.select().from(reportSnapshots).where(eq(reportSnapshots.accountId, accountId));
  const reports: Partial<Record<Period, Report>> = {};
  let computedAt: Date | null = null;
  for (const row of rows) {
    reports[row.period as Period] = row.data as Report;
    if (!computedAt || row.computedAt > computedAt) computedAt = row.computedAt;
  }
  return { reports, computedAt };
}

// Labels for the dashboard, read live: template bodies are the creator's own
// text; video titles are YouTube data and may already be gone (30-day rule).
export async function reportLabels(db: Db, accountId: string, report: Report | undefined) {
  const templateIds = (report?.byTemplate ?? []).map((r) => r.key).filter((k) => /^[0-9a-f-]{36}$/.test(k));
  const videoIds = (report?.byVideo ?? []).map((r) => r.key).filter((k) => k !== "(none)");
  const templateRows = templateIds.length
    ? await db.select({ id: templates.id, body: templates.body, language: templates.language }).from(templates).where(and(eq(templates.accountId, accountId), inArray(templates.id, templateIds)))
    : [];
  const videoRows = videoIds.length
    ? await db
        .select({ id: videos.youtubeVideoId, title: videos.title })
        .from(videos)
        .innerJoin(channels, eq(channels.id, videos.channelId))
        .where(and(eq(channels.accountId, accountId), inArray(videos.youtubeVideoId, videoIds)))
    : [];
  return {
    templates: new Map(templateRows.map((t) => [t.id, t])),
    videos: new Map(videoRows.filter((v) => v.title).map((v) => [v.id, v.title!])),
  };
}
