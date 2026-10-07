import { desc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { accounts, clicks, purchases, subscribers } from "@/db/schema";

export interface ActivityRow {
  at: Date;
  kind: "click" | "opt-in" | "purchase";
  account: string;
  videoId: string | null;
  keyword: string | null;
  detail: string;
}

// /admin, Recent activity: the last clicks, opt-ins and purchases across all
// accounts, so an end-to-end test can be followed without database access.
// No emails or names: video, keyword, source and whether the tracking id came along.
export async function recentActivity(db: Db, limit = 15): Promise<ActivityRow[]> {
  const [clickRows, optIns, sales] = await Promise.all([
    db
      .select({ at: clicks.createdAt, account: accounts.name, accountId: clicks.accountId, videoId: clicks.youtubeVideoId, keyword: clicks.keyword, isBot: clicks.isBot, host: clicks.host })
      .from(clicks)
      .innerJoin(accounts, eq(accounts.id, clicks.accountId))
      .orderBy(desc(clicks.createdAt))
      .limit(limit),
    db
      .select({ at: subscribers.occurredAt, account: accounts.name, accountId: subscribers.accountId, videoId: subscribers.youtubeVideoId, keyword: subscribers.keyword, source: subscribers.source, tid: subscribers.tid })
      .from(subscribers)
      .innerJoin(accounts, eq(accounts.id, subscribers.accountId))
      .orderBy(desc(subscribers.occurredAt))
      .limit(limit),
    db
      .select({
        at: purchases.occurredAt,
        account: accounts.name,
        accountId: purchases.accountId,
        videoId: purchases.attributedVideoId,
        keyword: purchases.attributedKeyword,
        source: purchases.source,
        amountCents: purchases.amountCents,
        currency: purchases.currency,
      })
      .from(purchases)
      .innerJoin(accounts, eq(accounts.id, purchases.accountId))
      .orderBy(desc(purchases.occurredAt))
      .limit(limit),
  ]);
  const rows: ActivityRow[] = [
    ...clickRows.map((r) => ({ at: r.at, kind: "click" as const, account: r.account ?? r.accountId, videoId: r.videoId, keyword: r.keyword, detail: `${r.host}${r.isBot ? ", bot" : ""}` })),
    ...optIns.map((r) => ({ at: r.at, kind: "opt-in" as const, account: r.account ?? r.accountId, videoId: r.videoId, keyword: r.keyword, detail: `${r.source}, ${r.tid ? "tracked" : "no tracking id"}` })),
    ...sales.map((r) => ({
      at: r.at,
      kind: "purchase" as const,
      account: r.account ?? r.accountId,
      videoId: r.videoId,
      keyword: r.keyword,
      detail: `${r.source}${r.amountCents !== null ? `, ${(r.amountCents / 100).toFixed(2)} ${r.currency ?? ""}` : ""}${r.keyword ? "" : ", not attributed"}`,
    })),
  ];
  return rows.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
}
