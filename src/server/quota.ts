import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { quotaLedger } from "@/db/schema";
import { canSpendOnRead, canSpendOnReply, type DayUsage, type QuotaMethod, REPLY_METHOD, UNIT_COSTS } from "@/lib/quota";
import { pacificDate } from "@/lib/time";
import type { DbOrTx } from "./accounts";
import { getNumberSetting } from "./settings";

// Serializes budget checks across worker jobs so two jobs cannot both take
// the last units of the day.
const QUOTA_LOCK_ID = 727_002;

export async function dayUsage(db: DbOrTx, datePt: string, gcpProject = "app"): Promise<DayUsage> {
  const [row] = await db
    .select({
      replies: sql<number>`coalesce(sum(${quotaLedger.units}) filter (where ${quotaLedger.method} = ${REPLY_METHOD}), 0)::int`,
      reads: sql<number>`coalesce(sum(${quotaLedger.units}) filter (where ${quotaLedger.method} <> ${REPLY_METHOD}), 0)::int`,
    })
    .from(quotaLedger)
    .where(and(eq(quotaLedger.gcpProject, gcpProject), eq(quotaLedger.datePt, datePt)));
  return { reads: row?.reads ?? 0, replies: row?.replies ?? 0 };
}

// Charges the units BEFORE the API call (YouTube charges failed calls too).
// Returns false, without charging, when the call does not fit today's budget:
// reads never touch the reply reserve, replies may use all that is left.
export async function reserveUnits(
  db: Db,
  input: { method: QuotaMethod; accountId: string | null; limit: number; calls?: number },
  now = new Date(),
): Promise<boolean> {
  const units = UNIT_COSTS[input.method] * (input.calls ?? 1);
  const datePt = pacificDate(now);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${QUOTA_LOCK_ID})`);
    const usage = await dayUsage(tx, datePt);
    const fits =
      input.method === REPLY_METHOD
        ? canSpendOnReply(usage, input.limit)
        : canSpendOnRead(usage, input.limit, await getNumberSetting(tx, "reply_reserve_pct"), units);
    if (!fits) return false;
    await tx.insert(quotaLedger).values({ gcpProject: "app", datePt, method: input.method, units, accountId: input.accountId });
    return true;
  });
}
