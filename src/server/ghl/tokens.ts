import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { integrations } from "@/db/schema";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import type { FetchLike } from "@/server/google/oauth";
import { createGhlApi, type GhlApi, GhlApiError } from "./api";
import { GhlOAuthError, refreshGhlToken } from "./oauth";

// The stored (encrypted) config of a GHL integration.
export interface GhlConfig {
  accessToken: string;
  refreshToken: string;
  // ISO time the access token expires.
  expiresAt: string;
  locationId: string;
  companyId: string | null;
  userId: string | null;
  // The contact custom field that carries the tracking id (vidrev tracking id).
  customFieldId: string | null;
  // The contact field "vidrev prospect id" (Beast Mode ownership proof, A-27).
  prospectFieldId?: string | null;
  // Contacts with this tag are buyers (revenue not reported), DECISIONS Q-06.
  buyerTag: string;
  locationName: string | null;
  // The Sub-account's website, read once at setup (absent on older grants).
  locationWebsite?: string | null;
}

export const DEFAULT_BUYER_TAG = "vidrev-buyer";
// The buyer tag default before the vidrev naming (DECISIONS A-11).
const LEGACY_BUYER_TAG = "c2c_buyer";

export function readGhlConfig(configEnc: string, key: string): GhlConfig {
  const config = JSON.parse(decryptSecret(configEnc, key)) as GhlConfig;
  return config.buyerTag === LEGACY_BUYER_TAG ? { ...config, buyerTag: DEFAULT_BUYER_TAG } : config;
}

export function sealGhlConfig(config: GhlConfig, key: string): string {
  return encryptSecret(JSON.stringify(config), key);
}

export interface GhlDeps {
  db: Db;
  fetch: FetchLike;
  encryptionKey: string;
  client: { clientId: string; clientSecret: string } | null;
  now?: () => Date;
  // Called once when the connection needs the creator to reconnect.
  onReauth?: (accountId: string) => Promise<void>;
}

// The creator has to reconnect: the refresh token was refused (uninstalled,
// revoked, expired after a year of no use).
export class GhlReauthError extends Error {
  constructor() {
    super("GHL connection needs to be reauthorized");
    this.name = "GhlReauthError";
  }
}

const REFRESH_MARGIN_MS = 5 * 60_000;

async function markReauth(deps: GhlDeps, integrationId: string, accountId: string): Promise<void> {
  const changed = await deps.db
    .update(integrations)
    .set({ status: "error", statusReason: "reauthorize", lastError: "GoHighLevel refused the connection. Reconnect it.", updatedAt: deps.now?.() ?? new Date() })
    .where(and(eq(integrations.id, integrationId), eq(integrations.status, "active")))
    .returning({ status: integrations.status });
  // Only the first failure emails the creator.
  if (changed.length > 0) await deps.onReauth?.(accountId);
}

// Returns a config with a valid access token. Refresh tokens rotate, so the
// integration row is locked while refreshing: two workers can never both use
// (and burn) the same refresh token.
export async function freshConfig(deps: GhlDeps, integrationId: string, force = false): Promise<GhlConfig> {
  const now = deps.now?.() ?? new Date();
  const outcome = await deps.db.transaction(async (tx): Promise<{ config: GhlConfig } | { reauthAccountId: string | null }> => {
    const [row] = await tx.select().from(integrations).where(eq(integrations.id, integrationId)).for("update");
    if (!row || !row.configEnc || row.status === "removed") return { reauthAccountId: null };
    const config = readGhlConfig(row.configEnc, deps.encryptionKey);
    if (!force && new Date(config.expiresAt).getTime() - now.getTime() > REFRESH_MARGIN_MS) return { config };
    if (!deps.client) throw new Error("GHL_CLIENT_ID or GHL_CLIENT_SECRET is not set");
    try {
      const tokens = await refreshGhlToken(deps.client, config.refreshToken, deps.fetch);
      const next: GhlConfig = {
        ...config,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: new Date(now.getTime() + tokens.expires_in * 1000).toISOString(),
      };
      await tx.update(integrations).set({ configEnc: sealGhlConfig(next, deps.encryptionKey), updatedAt: now }).where(eq(integrations.id, integrationId));
      return { config: next };
    } catch (error) {
      // A refused refresh token means the grant is gone; 5xx and 429 are transient.
      if (error instanceof GhlOAuthError && !error.code.startsWith("http_5") && error.code !== "http_429") return { reauthAccountId: row.accountId };
      throw error;
    }
  });
  if ("config" in outcome) return outcome.config;
  // Outside the transaction, so the status change is not rolled back.
  if (outcome.reauthAccountId) await markReauth(deps, integrationId, outcome.reauthAccountId);
  throw new GhlReauthError();
}

// Merges settings into the stored config. Reads the latest row under a lock,
// so a token refresh that happened meanwhile is never overwritten.
export async function updateGhlConfig(deps: GhlDeps, integrationId: string, patch: Partial<GhlConfig>): Promise<void> {
  await deps.db.transaction(async (tx) => {
    const [row] = await tx.select().from(integrations).where(eq(integrations.id, integrationId)).for("update");
    if (!row?.configEnc) return;
    const next = { ...readGhlConfig(row.configEnc, deps.encryptionKey), ...patch };
    await tx.update(integrations).set({ configEnc: sealGhlConfig(next, deps.encryptionKey), updatedAt: deps.now?.() ?? new Date() }).where(eq(integrations.id, integrationId));
  });
}

// Runs `fn` with an API client; one 401 triggers a forced refresh and a retry.
// A 401 for a missing scope is thrown as it is: it never burns a refresh and
// never marks the connection for a reconnect (the other calls still work).
export async function withGhlApi<T>(deps: GhlDeps, integrationId: string, fn: (api: GhlApi, config: GhlConfig) => Promise<T>): Promise<T> {
  let config = await freshConfig(deps, integrationId);
  try {
    return await fn(createGhlApi(deps.fetch, config.accessToken), config);
  } catch (error) {
    if (!(error instanceof GhlApiError) || error.status !== 401 || error.scopeDenied) throw error;
    config = await freshConfig(deps, integrationId, true);
    try {
      return await fn(createGhlApi(deps.fetch, config.accessToken), config);
    } catch (retryError) {
      if (retryError instanceof GhlApiError && retryError.status === 401 && !retryError.scopeDenied) {
        const [row] = await deps.db.select({ accountId: integrations.accountId }).from(integrations).where(eq(integrations.id, integrationId));
        if (row) await markReauth(deps, integrationId, row.accountId);
        throw new GhlReauthError();
      }
      throw retryError;
    }
  }
}
