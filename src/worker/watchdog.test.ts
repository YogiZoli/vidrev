import { describe, expect, it } from "vitest";
import { STALE_AFTER_MS, watchdogVerdict } from "./watchdog";

describe("worker watchdog", () => {
  it("is ok while the heartbeat completes", () => {
    expect(watchdogVerdict({ lastBeatOkAt: 0, now: STALE_AFTER_MS - 1, databaseOk: true })).toBe("ok");
  });

  it("restarts when jobs stopped but the database answers", () => {
    expect(watchdogVerdict({ lastBeatOkAt: 0, now: STALE_AFTER_MS, databaseOk: true })).toBe("restart");
  });

  it("waits when the database itself is down: a restart would not help", () => {
    expect(watchdogVerdict({ lastBeatOkAt: 0, now: STALE_AFTER_MS * 3, databaseOk: false })).toBe("wait_for_database");
  });
});
