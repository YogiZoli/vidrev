import { and, eq, ne } from "drizzle-orm";
import type { Db } from "@/db/client";
import { integrations } from "@/db/schema";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { keyLast4, keyProblem } from "@/lib/stripe";

// One Stripe account per creator account (DECISIONS P8-07). The creator pastes
// a restricted read-only key (P8-01); the worker checks it on the first sync.

export interface StripeConfig {
  apiKey: string;
  last4: string;
  accountName: string | null;
}

export function readStripeConfig(configEnc: string, key: string): StripeConfig {
  return JSON.parse(decryptSecret(configEnc, key)) as StripeConfig;
}

export function sealStripeConfig(config: StripeConfig, key: string): string {
  return encryptSecret(JSON.stringify(config), key);
}

export type ConnectStripeResult = { ok: true; id: string } | { ok: false; error: string };

export async function connectStripe(db: Db, encryptionKey: string, accountId: string, rawKey: string, now = new Date()): Promise<ConnectStripeResult> {
  const problem = keyProblem(rawKey);
  if (problem) return { ok: false, error: problem };
  const apiKey = rawKey.trim();
  const config = sealStripeConfig({ apiKey, last4: keyLast4(apiKey), accountName: null }, encryptionKey);

  const [existing] = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.accountId, accountId), eq(integrations.type, "stripe"), ne(integrations.status, "removed")));
  if (existing) {
    // A new key replaces the old one; the history already read is kept and the
    // key is checked again on the next run.
    await db
      .update(integrations)
      .set({
        configEnc: config,
        status: "active",
        statusReason: null,
        lastError: null,
        syncState: { ...existing.syncState, setup: "pending" },
        nextSyncAt: now,
        updatedAt: now,
      })
      .where(eq(integrations.id, existing.id));
    return { ok: true, id: existing.id };
  }
  const [row] = await db
    .insert(integrations)
    .values({
      accountId,
      type: "stripe",
      label: "Stripe",
      configEnc: config,
      // Stripe is a source of purchases only: no outbound events go to it.
      events: [],
      syncState: { setup: "pending" },
      nextSyncAt: now,
    })
    .returning({ id: integrations.id });
  return { ok: true, id: row!.id };
}

// Our side of a removal: the key is wiped. Only the creator can revoke it in
// Stripe (delete or roll the key), which the page says.
export async function disconnectStripe(db: Db, accountId: string, integrationId: string, now = new Date()): Promise<boolean> {
  const rows = await db
    .update(integrations)
    .set({ status: "removed", configEnc: null, statusReason: "disconnected", nextSyncAt: null, removedAt: now, updatedAt: now })
    .where(and(eq(integrations.id, integrationId), eq(integrations.accountId, accountId), eq(integrations.type, "stripe"), ne(integrations.status, "removed")))
    .returning({ id: integrations.id });
  return rows.length > 0;
}
