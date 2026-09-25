import { randomUUID } from "node:crypto";
import { and, count, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { integrations, outboundDeliveries } from "@/db/schema";
import { decryptSecret, encryptSecret, randomToken } from "@/lib/crypto";
import { checkWebhookUrl } from "@/lib/net-guard";
import { buildEventPayload, EVENT_NAMES, isEventName, SECRET_PREFIX } from "@/lib/webhooks";

// Outbound webhook endpoints a creator manages (SPEC section 11).

export const MAX_ENDPOINTS = 5;

export interface OutboundConfig {
  url: string;
  secret: string;
}

export function newSecret(): string {
  return `${SECRET_PREFIX}${randomToken(24)}`;
}

// Checkboxes: none or all ticked means every event (including future ones).
export function parseEventSelection(values: string[]): string[] | null {
  const chosen = [...new Set(values.filter(isEventName))];
  return chosen.length === 0 || chosen.length === EVENT_NAMES.length ? null : chosen;
}

export type CreateResult = { ok: true; id: string } | { ok: false; error: string };

export async function createEndpoint(
  db: Db,
  key: string,
  input: { accountId: string; url: string; label?: string; events?: string[] },
  options: { allowHttp?: boolean } = {},
): Promise<CreateResult> {
  const check = checkWebhookUrl(input.url, options);
  if (!check.ok) return { ok: false, error: check.error };
  const [existing] = await db
    .select({ n: count() })
    .from(integrations)
    .where(and(eq(integrations.accountId, input.accountId), eq(integrations.type, "outbound_webhook"), ne(integrations.status, "removed")));
  if ((existing?.n ?? 0) >= MAX_ENDPOINTS) return { ok: false, error: `You can add up to ${MAX_ENDPOINTS} endpoints.` };
  const config: OutboundConfig = { url: check.url.toString(), secret: newSecret() };
  const [row] = await db
    .insert(integrations)
    .values({
      accountId: input.accountId,
      type: "outbound_webhook",
      label: input.label?.trim().slice(0, 80) || check.url.hostname,
      configEnc: encryptSecret(JSON.stringify(config), key),
      events: parseEventSelection(input.events ?? []),
    })
    .returning({ id: integrations.id });
  return { ok: true, id: row!.id };
}

export async function readConfig(row: { configEnc: string | null }, key: string): Promise<OutboundConfig | null> {
  if (!row.configEnc) return null;
  return JSON.parse(decryptSecret(row.configEnc, key)) as OutboundConfig;
}

export async function listEndpoints(db: Db, accountId: string) {
  const rows = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.accountId, accountId), eq(integrations.type, "outbound_webhook"), ne(integrations.status, "removed")))
    .orderBy(integrations.createdAt);
  const pending = rows.length
    ? await db
        .select({ integrationId: outboundDeliveries.integrationId, n: count() })
        .from(outboundDeliveries)
        .where(and(inArray(outboundDeliveries.integrationId, rows.map((r) => r.id)), eq(outboundDeliveries.status, "pending")))
        .groupBy(outboundDeliveries.integrationId)
    : [];
  return rows.map((row) => ({ ...row, pending: pending.find((p) => p.integrationId === row.id)?.n ?? 0 }));
}

// The signing secret is shown again on the page; the account owner can always
// see it (it is the creator's own endpoint).
export async function revealEndpoint(db: Db, key: string, accountId: string, id: string): Promise<OutboundConfig | null> {
  const [row] = await db
    .select({ configEnc: integrations.configEnc })
    .from(integrations)
    .where(and(eq(integrations.id, id), eq(integrations.accountId, accountId), eq(integrations.type, "outbound_webhook"), ne(integrations.status, "removed")));
  return row ? readConfig(row, key) : null;
}

async function ownEndpoint(db: Db, accountId: string, id: string) {
  const [row] = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.id, id), eq(integrations.accountId, accountId), eq(integrations.type, "outbound_webhook"), ne(integrations.status, "removed")));
  return row ?? null;
}

export async function setEndpointEnabled(db: Db, accountId: string, id: string, enabled: boolean): Promise<boolean> {
  const row = await ownEndpoint(db, accountId, id);
  if (!row) return false;
  await db
    .update(integrations)
    .set({ status: enabled ? "active" : "disabled", statusReason: enabled ? null : "disabled_by_user", updatedAt: new Date() })
    .where(eq(integrations.id, id));
  return true;
}

export async function rotateSecret(db: Db, key: string, accountId: string, id: string): Promise<boolean> {
  const row = await ownEndpoint(db, accountId, id);
  const config = row ? await readConfig(row, key) : null;
  if (!row || !config) return false;
  await db
    .update(integrations)
    .set({ configEnc: encryptSecret(JSON.stringify({ ...config, secret: newSecret() }), key), updatedAt: new Date() })
    .where(eq(integrations.id, id));
  return true;
}

// Removing wipes the URL and secret; undelivered events are dropped.
export async function removeEndpoint(db: Db, accountId: string, id: string, now = new Date()): Promise<boolean> {
  const row = await ownEndpoint(db, accountId, id);
  if (!row) return false;
  await db.transaction(async (tx) => {
    await tx
      .update(integrations)
      .set({ status: "removed", configEnc: null, statusReason: "removed_by_user", removedAt: now, updatedAt: now })
      .where(eq(integrations.id, id));
    await tx
      .update(outboundDeliveries)
      .set({ status: "dead", lastError: "endpoint_removed", updatedAt: now })
      .where(and(eq(outboundDeliveries.integrationId, id), eq(outboundDeliveries.status, "pending")));
  });
  return true;
}

// The "Send test event" button: a ping that always goes to this one endpoint.
export async function queuePing(db: Db, accountId: string, id: string, now = new Date()): Promise<string | null> {
  const row = await ownEndpoint(db, accountId, id);
  if (!row || row.status !== "active") return null;
  const eventId = randomUUID();
  const [delivery] = await db
    .insert(outboundDeliveries)
    .values({
      accountId,
      integrationId: id,
      eventId,
      event: "ping",
      payload: buildEventPayload({ event: "ping", id: eventId, occurredAt: now, accountId }),
      nextAttemptAt: now,
    })
    .returning({ id: outboundDeliveries.id });
  return delivery?.id ?? null;
}

export function recentDeliveries(db: Db, accountId: string, limit = 15) {
  return db
    .select({
      id: outboundDeliveries.id,
      integrationId: outboundDeliveries.integrationId,
      event: outboundDeliveries.event,
      status: outboundDeliveries.status,
      attempt: outboundDeliveries.attempt,
      responseStatus: outboundDeliveries.responseStatus,
      lastError: outboundDeliveries.lastError,
      createdAt: outboundDeliveries.createdAt,
    })
    .from(outboundDeliveries)
    .where(eq(outboundDeliveries.accountId, accountId))
    .orderBy(desc(outboundDeliveries.createdAt))
    .limit(limit);
}

// Delivery logs are operational; the events themselves live in their own
// tables. Finished rows are dropped after 30 days.
export async function pruneDeliveries(db: Db, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - 30 * 86_400_000);
  const rows = await db
    .delete(outboundDeliveries)
    .where(and(ne(outboundDeliveries.status, "pending"), sql`${outboundDeliveries.updatedAt} < ${cutoff}`))
    .returning({ id: outboundDeliveries.id });
  return rows.length;
}
