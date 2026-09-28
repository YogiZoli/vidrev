import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { latestHeartbeat } from "@/db/heartbeat";
import { appVersion } from "@/lib/env";
import { evaluateHealth } from "@/lib/health";
import { errorFields, log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  let dbOk = false;
  let lastBeatAt: Date | null = null;

  try {
    const db = getDb();
    await db.execute(sql`select 1`);
    // A missing table (migrations not applied) must surface as unhealthy.
    lastBeatAt = await latestHeartbeat(db);
    dbOk = true;
  } catch (error) {
    log("error", "health check failed", errorFields(error));
  }

  const report = evaluateHealth({ dbOk, lastBeatAt, now: new Date() });
  return Response.json(
    { status: report.status, db: report.db, worker: report.worker, version: appVersion() },
    { status: report.httpStatus, headers: { "cache-control": "no-store" } },
  );
}
