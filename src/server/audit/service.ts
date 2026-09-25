import { and, desc, eq, gt, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { audits } from "@/db/schema";
import type { ChannelRef } from "@/lib/audit/handle";

// Shared by the web service (create a request) and the worker (run it).

export const CACHE_MS = 24 * 3_600_000;
export const API_DATA_TTL_MS = 30 * 86_400_000;

export type AuditRow = typeof audits.$inferSelect;

// A finished audit of the same channel from the last 24 hours whose API data
// is still there (DECISIONS P9-03: a hit costs no quota).
export async function findCachedAudit(db: Db, channelKey: string, now: Date, excludeId?: string): Promise<AuditRow | null> {
  const rows = await db
    .select()
    .from(audits)
    .where(and(eq(audits.channelKey, channelKey), eq(audits.status, "done"), gt(audits.fetchedAt, new Date(now.getTime() - CACHE_MS)), isNull(audits.apiDataScrubbedAt)))
    .orderBy(desc(audits.fetchedAt))
    .limit(2);
  return rows.find((row) => row.id !== excludeId) ?? null;
}

// Creates the request. A cache hit is completed at once with a copy of the
// result (the original `fetched_at` stays, so the 30 days never restart);
// otherwise the row is queued for the worker.
export async function createAudit(db: Db, ref: ChannelRef, input: string, now = new Date()): Promise<{ audit: AuditRow; cached: boolean }> {
  const cached = await findCachedAudit(db, ref.key, now);
  if (cached) {
    const [audit] = await db
      .insert(audits)
      .values({
        channelKey: ref.key,
        channelInput: input,
        status: "done",
        youtubeChannelId: cached.youtubeChannelId,
        result: cached.result,
        examples: cached.examples,
        fetchedAt: cached.fetchedAt,
      })
      .returning();
    return { audit: audit!, cached: true };
  }
  const [audit] = await db.insert(audits).values({ channelKey: ref.key, channelInput: input }).returning();
  return { audit: audit!, cached: false };
}

export async function getAudit(db: Db, id: string): Promise<AuditRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db.select().from(audits).where(eq(audits.id, id));
  return row ?? null;
}
