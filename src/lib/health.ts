// The worker beats every 60 s; three missed beats means it is stale.
export const HEARTBEAT_STALE_AFTER_SECONDS = 180;

export type WorkerState = "ok" | "stale" | "missing";

export interface HealthInput {
  dbOk: boolean;
  lastBeatAt: Date | null;
  now: Date;
}

export interface HealthReport {
  status: "ok" | "degraded" | "down";
  httpStatus: 200 | 503;
  db: "ok" | "down";
  worker: { state: WorkerState; ageSeconds: number | null };
}

// A stale worker degrades health but keeps 200, so a web deploy is never
// blocked by the separately deployed worker. Only a dead database is 503.
export function evaluateHealth({ dbOk, lastBeatAt, now }: HealthInput): HealthReport {
  if (!dbOk) {
    return {
      status: "down",
      httpStatus: 503,
      db: "down",
      worker: { state: "missing", ageSeconds: null },
    };
  }

  if (!lastBeatAt) {
    return { status: "degraded", httpStatus: 200, db: "ok", worker: { state: "missing", ageSeconds: null } };
  }

  const ageSeconds = Math.max(0, Math.round((now.getTime() - lastBeatAt.getTime()) / 1000));
  const state: WorkerState = ageSeconds > HEARTBEAT_STALE_AFTER_SECONDS ? "stale" : "ok";
  return {
    status: state === "ok" ? "ok" : "degraded",
    httpStatus: 200,
    db: "ok",
    worker: { state, ageSeconds },
  };
}
