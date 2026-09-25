import { and, eq, ne } from "drizzle-orm";
import type { Db } from "@/db/client";
import { integrations, outboundDeliveries } from "@/db/schema";
import type { GhlTokenResponse } from "./oauth";
import { DEFAULT_BUYER_TAG, type GhlConfig, readGhlConfig, sealGhlConfig } from "./tokens";

// One GHL location per account, and a location in one account at most (the
// unique index on (type, external_ref)).

export type ConnectResult = { ok: true; id: string } | { ok: false; error: "not_location" | "location_taken" | "already_connected" };

export const CONNECT_ERRORS = {
  not_location: "Choose one sub-account (location) when connecting, not the whole agency.",
  location_taken: "This GoHighLevel account is already connected to another account here.",
  already_connected: "Another GoHighLevel account is already connected. Disconnect it first.",
} as const;

export async function connectGhl(db: Db, key: string, accountId: string, tokens: GhlTokenResponse, now = new Date()): Promise<ConnectResult> {
  if ((tokens.userType && tokens.userType !== "Location") || !tokens.locationId) return { ok: false, error: "not_location" };
  const locationId = tokens.locationId;
  const live = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.type, "ghl"), eq(integrations.externalRef, locationId), ne(integrations.status, "removed")));
  const same = live.find((row) => row.accountId === accountId);
  if (live.some((row) => row.accountId !== accountId)) return { ok: false, error: "location_taken" };

  const [other] = await db
    .select({ id: integrations.id })
    .from(integrations)
    .where(and(eq(integrations.type, "ghl"), eq(integrations.accountId, accountId), ne(integrations.status, "removed")));
  if (other && !same) return { ok: false, error: "already_connected" };

  const config: GhlConfig = {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: new Date(now.getTime() + tokens.expires_in * 1000).toISOString(),
    locationId,
    companyId: tokens.companyId ?? null,
    userId: tokens.userId ?? null,
    customFieldId: null,
    buyerTag: DEFAULT_BUYER_TAG,
    locationName: null,
  };

  if (same) {
    // Reconnect (new grant): keep the choices made before, replace the tokens.
    let kept: Pick<GhlConfig, "customFieldId" | "buyerTag" | "locationName"> = { customFieldId: null, buyerTag: DEFAULT_BUYER_TAG, locationName: null };
    try {
      if (same.configEnc) {
        const old = readGhlConfig(same.configEnc, key);
        kept = { customFieldId: old.customFieldId, buyerTag: old.buyerTag, locationName: old.locationName };
      }
    } catch {
      // unreadable old config: start fresh
    }
    await db
      .update(integrations)
      .set({
        configEnc: sealGhlConfig({ ...config, ...kept }, key),
        status: "active",
        statusReason: null,
        lastError: null,
        nextSyncAt: now,
        updatedAt: now,
      })
      .where(eq(integrations.id, same.id));
    return { ok: true, id: same.id };
  }

  const [row] = await db
    .insert(integrations)
    .values({
      accountId,
      type: "ghl",
      label: "GoHighLevel",
      configEnc: sealGhlConfig(config, key),
      externalRef: locationId,
      // GHL is a target of the outbox for these two events (contact and tags).
      events: ["opt_in", "purchase"],
      syncState: { setup: "pending" },
      nextSyncAt: now,
    })
    .returning({ id: integrations.id });
  return { ok: true, id: row!.id };
}

// Our side of a removal: tokens are wiped and queued deliveries dropped.
export async function wipeGhl(db: Db, integrationId: string, reason: string, now = new Date()): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(integrations)
      .set({ status: "removed", configEnc: null, statusReason: reason, nextSyncAt: null, removedAt: now, updatedAt: now })
      .where(eq(integrations.id, integrationId));
    await tx
      .update(outboundDeliveries)
      .set({ status: "dead", lastError: "integration_removed", updatedAt: now })
      .where(and(eq(outboundDeliveries.integrationId, integrationId), eq(outboundDeliveries.status, "pending")));
  });
}

// The creator disconnects. They also remove the app inside GoHighLevel, which
// revokes the grant there (HighLevel has no token revocation endpoint).
export async function disconnectGhl(db: Db, accountId: string, integrationId: string, now = new Date()): Promise<boolean> {
  const [row] = await db
    .select({ id: integrations.id })
    .from(integrations)
    .where(and(eq(integrations.id, integrationId), eq(integrations.accountId, accountId), eq(integrations.type, "ghl"), ne(integrations.status, "removed")));
  if (!row) return false;
  await wipeGhl(db, integrationId, "disconnected", now);
  return true;
}
