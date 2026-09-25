import { and, count, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { accounts, auditLog, users } from "@/db/schema";
import { normalizeEmail } from "@/lib/email";

// Drizzle transactions expose the same query API as the db handle.
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

export async function findUserByEmail(db: DbOrTx, email: string) {
  const [row] = await db
    .select({ user: users, account: accounts })
    .from(users)
    .innerJoin(accounts, eq(accounts.id, users.accountId))
    .where(eq(users.email, normalizeEmail(email)))
    .limit(1);
  return row ?? null;
}

export async function createAccountWithUser(
  db: DbOrTx,
  input: { email: string; name?: string | null; planCode: string; trialEndsAt?: Date | null; billingRef?: string | null },
) {
  const [account] = await db
    .insert(accounts)
    .values({
      name: input.name ?? null,
      planCode: input.planCode,
      trialEndsAt: input.trialEndsAt ?? null,
      billingRef: input.billingRef ?? null,
    })
    .returning();
  const [user] = await db
    .insert(users)
    .values({ accountId: account!.id, email: normalizeEmail(input.email), name: input.name ?? null })
    .returning();
  return { account: account!, user: user! };
}

export async function countAccountsOnPlan(db: DbOrTx, planCode: string): Promise<number> {
  const [row] = await db.select({ n: count() }).from(accounts).where(eq(accounts.planCode, planCode));
  return row?.n ?? 0;
}

export async function writeAudit(
  db: DbOrTx,
  entry: { actor: string; accountId?: string | null; action: string; details?: Record<string, unknown> },
): Promise<void> {
  await db.insert(auditLog).values({
    actor: entry.actor,
    accountId: entry.accountId ?? null,
    action: entry.action,
    details: entry.details ?? {},
  });
}

// True when an audit entry with this action and details[key] = value exists
// (used to send one-time owner alerts only once).
export async function hasAudit(db: DbOrTx, action: string, key: string, value: string): Promise<boolean> {
  const rows = await db
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(and(eq(auditLog.action, action), sql`${auditLog.details} ->> ${key} = ${value}`))
    .limit(1);
  return rows.length > 0;
}
