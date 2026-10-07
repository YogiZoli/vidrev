import { desc, eq, inArray, or, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { accounts, crmProspectBackups, crmProspects } from "@/db/schema";

// /admin, Beast Mode deletions (A-27): what the 29 day sweep did or would do,
// and the backups that can still be restored. Ids only, no names.
export async function prospectOverview(db: Db) {
  const rows = await db
    .select({
      id: crmProspects.id,
      account: accounts.name,
      accountId: crmProspects.accountId,
      status: crmProspects.status,
      expiresAt: crmProspects.expiresAt,
      wouldDeleteAt: crmProspects.wouldDeleteAt,
      deletedAt: crmProspects.deletedAt,
      lastError: crmProspects.lastError,
    })
    .from(crmProspects)
    .innerJoin(accounts, eq(accounts.id, crmProspects.accountId))
    .where(
      or(
        inArray(crmProspects.status, ["kept", "abandoned", "unconfirmed"]),
        sql`(${crmProspects.wouldDeleteAt} is not null and ${crmProspects.status} = 'created')`,
        sql`${crmProspects.deletedAt} > now() - interval '2 days'`,
      ),
    )
    .orderBy(desc(crmProspects.updatedAt))
    .limit(200);
  const backups = await db
    .select({ id: crmProspectBackups.id, prospectId: crmProspectBackups.prospectId, expiresAt: crmProspectBackups.expiresAt, restoredAt: crmProspectBackups.restoredAt })
    .from(crmProspectBackups);
  const counts = await db.select({ status: crmProspects.status, n: sql<number>`count(*)::int` }).from(crmProspects).groupBy(crmProspects.status);
  return { rows, backups, counts };
}
