import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { integrations, users } from "@/db/schema";
import type { GhlSsoUser } from "@/lib/ghl-sso";

export type SsoSignIn = { ok: true; userId: string; accountId: string } | { ok: false; reason: "no_location" | "not_connected" };

// Inside GoHighLevel (DECISIONS A-22): the verified SSO user is let in as the
// vidrev account that connected this sub-account. Never on a location id from
// the URL alone: the location comes only from the decrypted SSO payload.
export async function signInFromGhl(db: Db, sso: GhlSsoUser): Promise<SsoSignIn> {
  if (!sso.activeLocation) return { ok: false, reason: "no_location" };
  const [row] = await db
    .select({ accountId: integrations.accountId, userId: users.id })
    .from(integrations)
    .innerJoin(users, eq(users.accountId, integrations.accountId))
    .where(and(eq(integrations.type, "ghl"), eq(integrations.externalRef, sso.activeLocation), eq(integrations.status, "active")))
    .orderBy(asc(users.createdAt))
    .limit(1);
  return row ? { ok: true, userId: row.userId, accountId: row.accountId } : { ok: false, reason: "not_connected" };
}
