import { and, asc, eq, lte } from "drizzle-orm";
import type { Db } from "@/db/client";
import { integrations, outboundDeliveries } from "@/db/schema";
import { log } from "@/lib/log";
import { nextAttemptAt, signBody } from "@/lib/webhooks";
import type { PostFn } from "@/server/integrations/http-post";
import { readConfig } from "@/server/integrations/outbound";

export interface WebhookDeps {
  db: Db;
  encryptionKey: string;
  post: PostFn;
  now?: () => Date;
}

const LEASE_MS = 5 * 60_000;
const BATCH = 100;
const CONCURRENCY = 10;

function shorten(text: string): string {
  return text.replace(/\s+/g, " ").slice(0, 300);
}

// Delivers one outbox row (SPEC section 11): signed JSON, 10 second timeout,
// any non-2xx or network error is retried with backoff for 24 hours. The row
// carries the retry state, so a lost job never loses an event; the engine tick
// picks up every due row.
export async function deliver(deps: WebhookDeps, deliveryId: string): Promise<void> {
  const now = deps.now?.() ?? new Date();
  // Claim: push next_attempt_at out by a lease, so a duplicate job or a tick
  // in parallel cannot post the same event twice.
  const [claimed] = await deps.db
    .update(outboundDeliveries)
    .set({ nextAttemptAt: new Date(now.getTime() + LEASE_MS) })
    .where(and(eq(outboundDeliveries.id, deliveryId), eq(outboundDeliveries.status, "pending"), lte(outboundDeliveries.nextAttemptAt, now)))
    .returning();
  if (!claimed) return;

  const [endpoint] = await deps.db.select().from(integrations).where(eq(integrations.id, claimed.integrationId));
  const config = endpoint && endpoint.status === "active" ? await readConfig(endpoint, deps.encryptionKey) : null;
  if (!endpoint || !config) {
    // A disabled or removed endpoint gets nothing; its queued events are dropped.
    await deps.db
      .update(outboundDeliveries)
      .set({ status: "dead", lastError: endpoint?.status === "active" ? "endpoint_config_missing" : "endpoint_not_active", updatedAt: now })
      .where(eq(outboundDeliveries.id, claimed.id));
    return;
  }

  const body = JSON.stringify(claimed.payload);
  const attempts = claimed.attempt + 1;
  let responseStatus: number | null = null;
  let error: string | null = null;
  try {
    const result = await deps.post(
      config.url,
      body,
      {
        "content-type": "application/json",
        "user-agent": "c2c-webhooks/1",
        "x-signature": signBody(body, config.secret),
        "x-event-id": claimed.eventId,
        "x-event-name": claimed.event,
      },
      10_000,
    );
    responseStatus = result.status;
    if (result.status < 200 || result.status >= 300) error = `http_${result.status}`;
  } catch (cause) {
    error = shorten(cause instanceof Error ? cause.message : String(cause));
  }

  if (!error) {
    await deps.db
      .update(outboundDeliveries)
      .set({ status: "delivered", attempt: attempts, responseStatus, lastError: null, deliveredAt: now, updatedAt: now })
      .where(eq(outboundDeliveries.id, claimed.id));
    await deps.db.update(integrations).set({ lastSuccessAt: now, lastError: null, updatedAt: now }).where(eq(integrations.id, endpoint.id));
    return;
  }

  const next = nextAttemptAt(attempts, claimed.createdAt, now);
  await deps.db
    .update(outboundDeliveries)
    .set({
      attempt: attempts,
      responseStatus,
      lastError: error,
      updatedAt: now,
      ...(next ? { nextAttemptAt: next } : { status: "dead" as const }),
    })
    .where(eq(outboundDeliveries.id, claimed.id));
  // 410 Gone: the receiver says the endpoint no longer exists.
  await deps.db
    .update(integrations)
    .set({
      lastError: error,
      updatedAt: now,
      ...(responseStatus === 410 ? { status: "disabled" as const, statusReason: "endpoint_gone" } : {}),
    })
    .where(eq(integrations.id, endpoint.id));
  log("warn", "webhook delivery failed", { deliveryId: claimed.id, attempt: attempts, error, willRetry: Boolean(next) });
}

// Every minute from the engine tick: due rows the immediate job missed.
export async function deliverDue(deps: WebhookDeps): Promise<number> {
  const now = deps.now?.() ?? new Date();
  const due = await deps.db
    .select({ id: outboundDeliveries.id })
    .from(outboundDeliveries)
    .where(and(eq(outboundDeliveries.status, "pending"), lte(outboundDeliveries.nextAttemptAt, now)))
    .orderBy(asc(outboundDeliveries.nextAttemptAt))
    .limit(BATCH);
  for (let i = 0; i < due.length; i += CONCURRENCY) {
    await Promise.all(due.slice(i, i + CONCURRENCY).map((row) => deliver(deps, row.id).catch((error: unknown) => log("error", "webhook delivery crashed", { deliveryId: row.id, error: String(error) }))));
  }
  return due.length;
}
