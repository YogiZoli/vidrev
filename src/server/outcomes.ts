import { and, eq, isNotNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { publishingCardKeywords, purchases, replies, subscribers } from "@/db/schema";

// What a published video's keywords brought, for PDT (DECISIONS A-35). Counts
// only: nobody is named and no YouTube data leaves vidrev (A-12). People are
// counted once (Contacts, section 13). Revenue is the net of canonical
// payments in the account's reporting currency, never converted; payments in
// other currencies still count as buyers.

export interface KeywordOutcome {
  keyword: string;
  commenters: number;
  emailSubscribers: number;
  buyers: number;
  revenue: number;
}

export interface VideoOutcomes {
  videoId: string;
  currency: string;
  keywords: KeywordOutcome[];
}

export async function videoOutcomes(db: Db, account: { id: string; reportingCurrency: string }, videoId: string): Promise<VideoOutcomes> {
  const commenters = await db
    .select({ keyword: sql<string>`upper(${replies.keyword})`, n: sql<number>`count(distinct coalesce(${replies.contactId}::text, ${replies.id}::text))::int` })
    .from(replies)
    .where(and(eq(replies.accountId, account.id), eq(replies.youtubeVideoId, videoId)))
    .groupBy(sql`1`);
  const subscribed = await db
    .select({ keyword: sql<string>`upper(${subscribers.keyword})`, n: sql<number>`count(distinct coalesce(${subscribers.contactId}::text, ${subscribers.emailNorm}))::int` })
    .from(subscribers)
    .where(and(eq(subscribers.accountId, account.id), eq(subscribers.youtubeVideoId, videoId), isNotNull(subscribers.keyword)))
    .groupBy(sql`1`);
  const bought = await db
    .select({
      keyword: sql<string>`upper(${purchases.attributedKeyword})`,
      n: sql<number>`count(distinct coalesce(${purchases.contactId}::text, ${purchases.emailNorm}, ${purchases.tid}, ${purchases.id}::text))::int`,
      cents: sql<number>`coalesce(sum(${purchases.netCents}) filter (where upper(${purchases.currency}) = ${account.reportingCurrency.toUpperCase()}), 0)::bigint`,
    })
    .from(purchases)
    // Canonical rows only: a duplicate of the same sale never counts twice.
    .where(and(eq(purchases.accountId, account.id), eq(purchases.attributedVideoId, videoId), isNotNull(purchases.attributedKeyword), sql`${purchases.canonicalPurchaseId} = ${purchases.id}`))
    .groupBy(sql`1`);
  // The card's keywords show even before anyone commented.
  const carded = await db
    .selectDistinct({ keyword: publishingCardKeywords.keyword })
    .from(publishingCardKeywords)
    .where(and(eq(publishingCardKeywords.accountId, account.id), eq(publishingCardKeywords.youtubeVideoId, videoId)));

  const byKeyword = new Map<string, KeywordOutcome>();
  const row = (keyword: string) => {
    let out = byKeyword.get(keyword);
    if (!out) byKeyword.set(keyword, (out = { keyword, commenters: 0, emailSubscribers: 0, buyers: 0, revenue: 0 }));
    return out;
  };
  for (const c of carded) row(c.keyword);
  for (const c of commenters) row(c.keyword).commenters = Number(c.n);
  for (const s of subscribed) row(s.keyword).emailSubscribers = Number(s.n);
  for (const p of bought) {
    const out = row(p.keyword);
    out.buyers = Number(p.n);
    out.revenue = Number(p.cents) / 100;
  }
  return { videoId, currency: account.reportingCurrency, keywords: [...byKeyword.values()].sort((a, b) => a.keyword.localeCompare(b.keyword)) };
}
