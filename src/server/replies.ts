import { and, eq, inArray, sql } from "drizzle-orm";
import { replies, type ReplyStatus } from "@/db/schema";
import type { ReplyUsage } from "@/lib/plans";
import { pacificDate, pacificMonth } from "@/lib/time";
import type { DbOrTx } from "./accounts";

// Replies that count against the plan caps: approved ones, whether sent by
// the API, waiting in the queue or posted by hand.
export const COUNTED_STATUSES: ReplyStatus[] = ["approved", "queued", "sending", "sent", "sent_manually"];

// Usage in the Pacific-time month and day (the quota calendar, D-31).
export async function replyUsage(db: DbOrTx, accountId: string, now = new Date()): Promise<ReplyUsage> {
  const localDay = sql`(${replies.approvedAt} at time zone 'America/Los_Angeles')::date`;
  const [row] = await db
    .select({
      thisMonth: sql<number>`count(*) filter (where to_char(${localDay}, 'YYYY-MM') = ${pacificMonth(now)})::int`,
      today: sql<number>`count(*) filter (where ${localDay} = ${pacificDate(now)}::date)::int`,
    })
    .from(replies)
    .where(and(eq(replies.accountId, accountId), inArray(replies.status, COUNTED_STATUSES)));
  return { thisMonth: row?.thisMonth ?? 0, today: row?.today ?? 0 };
}
