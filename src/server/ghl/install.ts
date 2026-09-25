import { and, eq, lt, ne } from "drizzle-orm";
import type { Db } from "@/db/client";
import { accounts, ghlInstalls, integrations } from "@/db/schema";
import { decryptSecret, encryptSecret, randomToken, sha256Hex } from "@/lib/crypto";
import { type ConnectResult, connectGhl } from "./connect";
import type { GhlTokenResponse } from "./oauth";

// One-click install from the HighLevel Marketplace listing (DECISIONS P10-01
// to P10-04). HighLevel sends the installer's browser to our callback with a
// code and no state of ours, and the installer may not be signed in here. The
// grant is exchanged at once (codes are short-lived) and then either goes to
// the account that already owns the location, or waits for a signed-in account
// to claim it with a token only the installer's browser holds.

export const INSTALL_TTL_MS = 24 * 3_600_000;

interface PendingPayload {
  tokens: GhlTokenResponse;
  obtainedAt: string;
}

export type MarketplaceInstall =
  | { kind: "reconnected"; accountId: string; integrationId: string }
  | { kind: "pending"; claimToken: string }
  | { kind: "error"; error: "not_location" };

export async function receiveMarketplaceInstall(db: Db, key: string, tokens: GhlTokenResponse, now = new Date()): Promise<MarketplaceInstall> {
  if ((tokens.userType && tokens.userType !== "Location") || !tokens.locationId) return { kind: "error", error: "not_location" };
  const locationId = tokens.locationId;

  // The location already belongs to an account: a reinstall only refreshes its
  // grant there, so nobody can move a connected location to another account.
  const [owner] = await db
    .select({ accountId: integrations.accountId, status: accounts.status })
    .from(integrations)
    .innerJoin(accounts, eq(accounts.id, integrations.accountId))
    .where(and(eq(integrations.type, "ghl"), eq(integrations.externalRef, locationId), ne(integrations.status, "removed")));
  if (owner?.status === "active") {
    const result = await connectGhl(db, key, owner.accountId, tokens, now);
    if (result.ok) return { kind: "reconnected", accountId: owner.accountId, integrationId: result.id };
  }

  const claimToken = randomToken();
  const payload: PendingPayload = { tokens, obtainedAt: now.toISOString() };
  await db.transaction(async (tx) => {
    // The latest install of a location wins; older unclaimed grants are dropped.
    await tx.delete(ghlInstalls).where(eq(ghlInstalls.locationId, locationId));
    await tx.insert(ghlInstalls).values({
      locationId,
      claimHash: sha256Hex(claimToken),
      configEnc: encryptSecret(JSON.stringify(payload), key),
      createdAt: now,
      expiresAt: new Date(now.getTime() + INSTALL_TTL_MS),
    });
  });
  return { kind: "pending", claimToken };
}

export async function hasPendingInstall(db: Db, claimToken: string, now = new Date()): Promise<boolean> {
  const [row] = await db.select({ id: ghlInstalls.id, expiresAt: ghlInstalls.expiresAt }).from(ghlInstalls).where(eq(ghlInstalls.claimHash, sha256Hex(claimToken)));
  return Boolean(row && row.expiresAt > now);
}

export type ClaimResult = ConnectResult | { ok: false; error: "expired" };

// A signed-in account takes the waiting grant. The row is deleted only after
// the connection succeeded, so a refused claim (location taken, another CRM
// already connected) can be retried once the cause is gone.
export async function claimInstall(db: Db, key: string, accountId: string, claimToken: string, now = new Date()): Promise<ClaimResult> {
  const [row] = await db.select().from(ghlInstalls).where(eq(ghlInstalls.claimHash, sha256Hex(claimToken)));
  if (!row || row.expiresAt <= now) return { ok: false, error: "expired" };

  let payload: PendingPayload;
  try {
    payload = JSON.parse(decryptSecret(row.configEnc, key)) as PendingPayload;
  } catch {
    return { ok: false, error: "expired" };
  }
  const elapsed = Math.floor((now.getTime() - new Date(payload.obtainedAt).getTime()) / 1000);
  // An access token lives about a day; the worker refreshes it before use.
  const tokens: GhlTokenResponse = { ...payload.tokens, expires_in: Math.max(60, payload.tokens.expires_in - elapsed) };

  const result = await connectGhl(db, key, accountId, tokens, now);
  if (result.ok) await db.delete(ghlInstalls).where(eq(ghlInstalls.id, row.id));
  return result;
}

// Retention: waiting grants are not kept past their day.
export async function deleteExpiredInstalls(db: Db, now = new Date()): Promise<number> {
  const rows = await db.delete(ghlInstalls).where(lt(ghlInstalls.expiresAt, now)).returning({ id: ghlInstalls.id });
  return rows.length;
}
