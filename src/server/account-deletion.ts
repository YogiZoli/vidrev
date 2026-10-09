import { and, eq, inArray, lt, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { accounts, auditLog, channels, users } from "@/db/schema";
import { writeAudit } from "./accounts";

// Closing an account (Privacy Policy section 4, Data Deletion page). The request
// stops everything at once (the account is suspended and every channel is set
// to disconnect); the worker then revokes the Google grants, removes what vidrev
// put in the connected CRM, and deletes the account row, which cascades to all
// of its data. The audit row survives (account id set to null) as the proof.

export const DELETION_REQUESTED = "account.deletion_requested";
export const DELETION_DONE = "account.deleted";
// A request whose job was lost is queued again by the hourly pass after this.
export const DELETION_RETRY_MS = 15 * 60_000;

export async function requestAccountDeletion(db: Db, input: { accountId: string; userId: string }, now = new Date()): Promise<void> {
  await db.transaction(async (tx) => {
    const emails = await tx.select({ email: users.email }).from(users).where(eq(users.accountId, input.accountId));
    await tx.update(accounts).set({ status: "suspended" }).where(eq(accounts.id, input.accountId));
    await tx
      .update(channels)
      .set({ status: "disconnecting", disconnectedAt: now })
      .where(and(eq(channels.accountId, input.accountId), inArray(channels.status, ["connecting", "connected", "revoked", "rejected"])));
    await writeAudit(tx, {
      actor: `user:${input.userId}`,
      accountId: input.accountId,
      action: DELETION_REQUESTED,
      details: { emails: emails.map((e) => e.email), requestedAt: now.toISOString() },
    });
  });
}

export async function deletionRequested(db: Db, accountId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(and(eq(auditLog.accountId, accountId), eq(auditLog.action, DELETION_REQUESTED)))
    .limit(1);
  return Boolean(row);
}

// Accounts whose deletion was asked for more than DELETION_RETRY_MS ago and
// still exist: their job was lost or keeps failing.
export async function pendingDeletions(db: Db, now = new Date()): Promise<string[]> {
  const rows = await db
    .selectDistinct({ accountId: auditLog.accountId })
    .from(auditLog)
    .innerJoin(accounts, eq(accounts.id, auditLog.accountId))
    .where(and(eq(auditLog.action, DELETION_REQUESTED), lt(auditLog.createdAt, new Date(now.getTime() - DELETION_RETRY_MS)), sql`${auditLog.accountId} is not null`));
  return rows.map((r) => r.accountId!).filter(Boolean);
}
