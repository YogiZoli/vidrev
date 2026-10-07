// The worker's own check that jobs still run. pg-boss can lose its
// connection and stay "started" while nothing is fetched: no polls, drafts,
// sends, and the health server still says ok. Railway restarts the worker
// only when the process exits, so the watchdog exits when the heartbeat job
// has not completed for STALE_AFTER_MS while the database answers. When the
// database itself is down a restart would not help (and would burn Railway's
// restart budget), so it only logs and waits.
export const STALE_AFTER_MS = 5 * 60_000;

export type WatchdogVerdict = "ok" | "wait_for_database" | "restart";

export function watchdogVerdict(input: { lastBeatOkAt: number; now: number; databaseOk: boolean }): WatchdogVerdict {
  if (input.now - input.lastBeatOkAt < STALE_AFTER_MS) return "ok";
  return input.databaseOk ? "restart" : "wait_for_database";
}
