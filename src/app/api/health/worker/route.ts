import { getDb } from "@/db/client";
import { latestHeartbeat } from "@/db/heartbeat";
import { evaluateHealth } from "@/lib/health";
import { errorFields, log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// For an external uptime monitor: 503 when the worker has missed its
// heartbeat for 3 minutes (nothing is polled, drafted or sent then) or the
// database is down. /api/health stays 200 for a stale worker on purpose, so
// a web deploy is never blocked by the worker.
export async function GET(): Promise<Response> {
  let dbOk = false;
  let lastBeatAt: Date | null = null;
  try {
    lastBeatAt = await latestHeartbeat(getDb());
    dbOk = true;
  } catch (error) {
    log("error", "worker health check failed", errorFields(error));
  }
  const report = evaluateHealth({ dbOk, lastBeatAt, now: new Date() });
  const ok = report.db === "ok" && report.worker.state === "ok";
  if (!ok) log("error", "worker is not healthy", { db: report.db, worker: report.worker.state, ageSeconds: report.worker.ageSeconds });
  return Response.json(
    { status: ok ? "ok" : "down", db: report.db, worker: report.worker },
    { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
