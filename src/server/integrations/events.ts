import { randomUUID } from "node:crypto";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { integrations, outboundDeliveries } from "@/db/schema";
import type { JobPayloads } from "@/jobs/queues";
import { errorFields, log } from "@/lib/log";
import { buildEventPayload, type DeliveredEvent, type EventContext, type EventName } from "@/lib/webhooks";
import type { DbOrTx } from "../accounts";
import { markReportDirty } from "../attribution";

export interface EmitInput {
  accountId: string;
  event: EventName;
  occurredAt?: Date;
  context?: EventContext;
  eventId?: string;
}

// Writes one outbox row per active endpoint that subscribes to the event
// (SPEC section 11). Nothing leaves the database here: the worker delivers.
// Returns the delivery ids so the caller can wake the worker at once.
export async function emitEvent(db: DbOrTx, input: EmitInput): Promise<string[]> {
  const endpoints = await db
    .select({ id: integrations.id })
    .from(integrations)
    .where(
      and(
        eq(integrations.accountId, input.accountId),
        inArray(integrations.type, ["outbound_webhook", "ghl"]),
        eq(integrations.status, "active"),
        or(sql`${integrations.events} is null`, sql`${input.event} = any(${integrations.events})`),
      ),
    );
  if (endpoints.length === 0) return [];
  const eventId = input.eventId ?? randomUUID();
  const occurredAt = input.occurredAt ?? new Date();
  const payload = buildEventPayload({ event: input.event, id: eventId, occurredAt, accountId: input.accountId, context: input.context });
  const rows = await db
    .insert(outboundDeliveries)
    .values(
      endpoints.map((endpoint) => ({
        accountId: input.accountId,
        integrationId: endpoint.id,
        eventId,
        event: input.event as DeliveredEvent,
        payload,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: outboundDeliveries.id });
  return rows.map((row) => row.id);
}

export type Kick = (deliveryIds: string[]) => Promise<void>;

// Web and worker both emit events on the way through their normal work; a
// failure here must never break a click, a reply or an opt-in. The tick picks
// up anything the immediate kick misses.
export async function emitEventSafely(db: DbOrTx, input: EmitInput, kick: Kick): Promise<void> {
  try {
    // Every event is also new report data (Phase 7): comments, replies,
    // clicks, opt-ins and purchases all pass through here.
    await markReportDirty(db, input.accountId);
    const ids = await emitEvent(db, input);
    if (ids.length > 0) await kick(ids).catch((error: unknown) => log("warn", "webhook kick failed", errorFields(error)));
  } catch (error) {
    log("error", "emitting event failed", { ...errorFields(error), event: input.event, accountId: input.accountId });
  }
}

// Worker side: jobs go straight into pg-boss.
export function kickWith(enqueue: <Q extends keyof JobPayloads>(queue: Q, data: JobPayloads[Q], options?: { singletonKey?: string }) => Promise<void>): Kick {
  return async (ids) => {
    for (const deliveryId of ids) await enqueue("webhook.deliver", { deliveryId }, { singletonKey: deliveryId });
  };
}
