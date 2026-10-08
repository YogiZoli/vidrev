import { and, eq, gt, isNull, lt } from "drizzle-orm";
import type { Db } from "@/db/client";
import { accounts, pdtConnectCodes, pdtConnections, users } from "@/db/schema";
import { randomToken, sha256Hex } from "@/lib/crypto";

// Publishing Dream Team connection (DECISIONS A-30). The creator allows PDT on
// /connect/pdt, PDT trades the one-time code for a personal access token and
// calls the API with it. Codes and tokens are stored as hashes only; the
// token itself exists only in the answer to PDT.

export const PDT_TOKEN_PREFIX = "vidrev_pat_";
export const CODE_TTL_MS = 10 * 60_000;
export const DEFAULT_PDT_ORIGINS = "https://dreamteam.commentclient.com";

// Origins PDT may be sent back to (PDT_REDIRECT_ORIGINS, comma separated).
export function pdtRedirectOrigins(source: Record<string, string | undefined> = process.env): string[] {
  const list = (source.PDT_REDIRECT_ORIGINS?.trim() || DEFAULT_PDT_ORIGINS).split(",");
  const out: string[] = [];
  for (const item of list) {
    try {
      const url = new URL(item.trim());
      if (url.protocol === "https:" || url.hostname === "localhost" || url.hostname === "127.0.0.1") out.push(url.origin);
    } catch {
      // A malformed entry is ignored; the others still work.
    }
  }
  return out;
}

// The redirect_uri as a URL when its origin is allowed, else null. No user
// info in the address and no fragment (the code must reach PDT's server).
export function checkRedirectUri(value: string | null | undefined, origins: readonly string[]): URL | null {
  if (!value || value.length > 2000) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash) return null;
    return origins.includes(url.origin) ? url : null;
  } catch {
    return null;
  }
}

export function redirectWith(uri: URL, params: Record<string, string>): string {
  const url = new URL(uri.toString());
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

export async function issueConnectCode(
  db: Db,
  input: { accountId: string; userId: string; redirectOrigin: string },
  now = new Date(),
): Promise<string> {
  const code = randomToken();
  // Old codes are useless after 10 minutes; tidy them up here.
  await db.delete(pdtConnectCodes).where(lt(pdtConnectCodes.expiresAt, new Date(now.getTime() - 86_400_000)));
  await db.insert(pdtConnectCodes).values({
    codeHash: sha256Hex(code),
    accountId: input.accountId,
    userId: input.userId,
    redirectOrigin: input.redirectOrigin,
    expiresAt: new Date(now.getTime() + CODE_TTL_MS),
    createdAt: now,
  });
  return code;
}

export interface Exchanged {
  token: string;
  accountId: string;
  accountName: string;
}

// Single use: the update matches only an unused, unexpired code, so two
// parallel exchanges cannot both get a token. A new connection revokes the
// account's previous one (one PDT connection per account).
export async function exchangeConnectCode(db: Db, code: string, now = new Date()): Promise<Exchanged | null> {
  if (!code || code.length > 200) return null;
  return db.transaction(async (tx) => {
    const [used] = await tx
      .update(pdtConnectCodes)
      .set({ usedAt: now })
      .where(and(eq(pdtConnectCodes.codeHash, sha256Hex(code)), isNull(pdtConnectCodes.usedAt), gt(pdtConnectCodes.expiresAt, now)))
      .returning({ accountId: pdtConnectCodes.accountId, userId: pdtConnectCodes.userId });
    if (!used) return null;
    await tx.update(pdtConnections).set({ revokedAt: now }).where(and(eq(pdtConnections.accountId, used.accountId), isNull(pdtConnections.revokedAt)));
    const token = `${PDT_TOKEN_PREFIX}${randomToken()}`;
    await tx.insert(pdtConnections).values({ accountId: used.accountId, userId: used.userId, tokenHash: sha256Hex(token), createdAt: now });
    const [row] = await tx
      .select({ name: accounts.name, email: users.email })
      .from(accounts)
      .leftJoin(users, eq(users.id, used.userId))
      .where(eq(accounts.id, used.accountId));
    return { token, accountId: used.accountId, accountName: row?.name?.trim() || row?.email || "vidrev account" };
  });
}

export interface PdtCaller {
  connectionId: string;
  account: typeof accounts.$inferSelect;
}

export function bearerToken(headers: Headers): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(headers.get("authorization")?.trim() ?? "");
  return match?.[1] ?? null;
}

// The live connection behind a token, or null (unknown, malformed or revoked).
export async function authenticatePdt(db: Db, token: string | null, now = new Date()): Promise<PdtCaller | null> {
  if (!token?.startsWith(PDT_TOKEN_PREFIX) || token.length > 200) return null;
  const [row] = await db
    .select({ connectionId: pdtConnections.id, account: accounts })
    .from(pdtConnections)
    .innerJoin(accounts, eq(accounts.id, pdtConnections.accountId))
    .where(and(eq(pdtConnections.tokenHash, sha256Hex(token)), isNull(pdtConnections.revokedAt)));
  if (!row) return null;
  await db.update(pdtConnections).set({ lastUsedAt: now }).where(eq(pdtConnections.id, row.connectionId));
  return row;
}

export async function revokePdtConnection(db: Db, connectionId: string, now = new Date()): Promise<void> {
  await db.update(pdtConnections).set({ revokedAt: now }).where(and(eq(pdtConnections.id, connectionId), isNull(pdtConnections.revokedAt)));
}
