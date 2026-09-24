import { describe, expect, it } from "vitest";
import { evaluateHealth, HEARTBEAT_STALE_AFTER_SECONDS } from "./health";

const now = new Date("2026-09-25T12:00:00Z");
const secondsAgo = (s: number) => new Date(now.getTime() - s * 1000);

describe("evaluateHealth", () => {
  it("is down with 503 when the database is unreachable", () => {
    const report = evaluateHealth({ dbOk: false, lastBeatAt: null, now });
    expect(report.status).toBe("down");
    expect(report.httpStatus).toBe(503);
  });

  it("is degraded but 200 when the worker never beat", () => {
    const report = evaluateHealth({ dbOk: true, lastBeatAt: null, now });
    expect(report).toMatchObject({ status: "degraded", httpStatus: 200, worker: { state: "missing" } });
  });

  it("is ok with a fresh heartbeat", () => {
    const report = evaluateHealth({ dbOk: true, lastBeatAt: secondsAgo(30), now });
    expect(report).toMatchObject({ status: "ok", httpStatus: 200, worker: { state: "ok", ageSeconds: 30 } });
  });

  it("is degraded when the heartbeat is older than the threshold", () => {
    const report = evaluateHealth({
      dbOk: true,
      lastBeatAt: secondsAgo(HEARTBEAT_STALE_AFTER_SECONDS + 1),
      now,
    });
    expect(report).toMatchObject({ status: "degraded", httpStatus: 200, worker: { state: "stale" } });
  });

  it("treats a heartbeat from the future as age zero", () => {
    const report = evaluateHealth({ dbOk: true, lastBeatAt: secondsAgo(-5), now });
    expect(report.worker.ageSeconds).toBe(0);
  });
});
