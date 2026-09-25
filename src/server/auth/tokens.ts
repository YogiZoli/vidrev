import { and, count, eq, gt, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { accounts, magicLinkTokens, plans, sessions, users } from "@/db/schema";
import { randomToken, sha256Hex } from "@/lib/crypto";

export const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
// Per user, within one magic link lifetime; protects the inbox and Resend limits.
export const MAGIC_LINK_MAX_PER_WINDOW = 5;

// Returns null when the rate limit is reached; callers never reveal that.
export async function issueMagicLink(db: Db, userId: string, now = new Date()): Promise<string | null> {
  const windowStart = new Date(now.getTime() - MAGIC_LINK_TTL_MS);
  const [recent] = await db
    .select({ n: count() })
    .from(magicLinkTokens)
    .where(and(eq(magicLinkTokens.userId, userId), gt(magicLinkTokens.createdAt, windowStart)));
  if ((recent?.n ?? 0) >= MAGIC_LINK_MAX_PER_WINDOW) return null;

  const token = randomToken();
  await db.insert(magicLinkTokens).values({
    tokenHash: sha256Hex(token),
    userId,
    expiresAt: new Date(now.getTime() + MAGIC_LINK_TTL_MS),
    createdAt: now,
  });
  return token;
}

// Single use: the update only matches an unused, unexpired token, so two
// parallel clicks cannot both sign in.
export async function consumeMagicLink(db: Db, token: string, now = new Date()): Promise<string | null> {
  const [row] = await db
    .update(magicLinkTokens)
    .set({ usedAt: now })
    .where(
      and(
        eq(magicLinkTokens.tokenHash, sha256Hex(token)),
        isNull(magicLinkTokens.usedAt),
        gt(magicLinkTokens.expiresAt, now),
      ),
    )
    .returning({ userId: magicLinkTokens.userId });
  if (!row) return null;
  await db.update(users).set({ lastLoginAt: now }).where(eq(users.id, row.userId));
  return row.userId;
}

export async function createSession(db: Db, userId: string, now = new Date()): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await db.insert(sessions).values({ userId, tokenHash: sha256Hex(token), expiresAt, createdAt: now });
  return { token, expiresAt };
}

export async function deleteSession(db: Db, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, sha256Hex(token)));
}

export interface SessionContext {
  user: typeof users.$inferSelect;
  account: typeof accounts.$inferSelect;
  plan: typeof plans.$inferSelect;
}

export async function findSession(db: Db, token: string, now = new Date()): Promise<SessionContext | null> {
  const [row] = await db
    .select({ user: users, account: accounts, plan: plans })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(accounts, eq(accounts.id, users.accountId))
    .innerJoin(plans, eq(plans.code, accounts.planCode))
    .where(and(eq(sessions.tokenHash, sha256Hex(token)), gt(sessions.expiresAt, now)))
    .limit(1);
  return row ?? null;
}
