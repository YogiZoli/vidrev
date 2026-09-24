import { desc } from "drizzle-orm";
import type { Db } from "./client";
import { workerHeartbeats } from "./schema";

export async function recordHeartbeat(db: Db, id: string, version: string, at = new Date()): Promise<void> {
  await db
    .insert(workerHeartbeats)
    .values({ id, beatAt: at, version })
    .onConflictDoUpdate({ target: workerHeartbeats.id, set: { beatAt: at, version } });
}

export async function latestHeartbeat(db: Db): Promise<Date | null> {
  const rows = await db
    .select({ beatAt: workerHeartbeats.beatAt })
    .from(workerHeartbeats)
    .orderBy(desc(workerHeartbeats.beatAt))
    .limit(1);
  return rows[0]?.beatAt ?? null;
}
