import { describe, expect, it } from "vitest";
import { sizeQuota } from "./quota-sizing";

describe("sizeQuota", () => {
  it("answers with no numbers when nothing was measured", () => {
    const sizing = sizeQuota([], 0);
    expect(sizing).toMatchObject({ days: 0, totalUnits: 0, unitsPerChannelPerDay: null, suggestedRequest: null, projection: [] });
  });

  it("does not project without an active channel", () => {
    expect(sizeQuota([{ datePt: "2026-09-25", method: "commentThreads.list", units: 100 }], 0).suggestedRequest).toBeNull();
  });

  it("sizes per channel per day from real days and rounds the request up", () => {
    const rows = [
      { datePt: "2026-09-24", method: "commentThreads.list", units: 200 },
      { datePt: "2026-09-24", method: "comments.insert", units: 500 },
      { datePt: "2026-09-25", method: "commentThreads.list", units: 300 },
      { datePt: "2026-09-25", method: "comments.insert", units: 900 },
    ];
    const sizing = sizeQuota(rows, 2);
    expect(sizing.days).toBe(2);
    expect(sizing.totalUnits).toBe(1900);
    expect(sizing.averageDayUnits).toBe(950);
    expect(sizing.peakDayUnits).toBe(1200);
    expect(sizing.unitsPerChannelPerDay).toBe(475);
    expect(sizing.byMethod[0]).toMatchObject({ method: "comments.insert", units: 1400 });
    expect(sizing.projection.find((p) => p.channels === 100)?.unitsPerDay).toBe(47_500);
    // 475 * 100 * 1.3 = 61,750 rounds up to 70,000
    expect(sizing.suggestedRequest).toBe(70_000);
    expect(sizing.projection.map((p) => p.channels)).toEqual([100, 1_000, 10_000]);
  });

  it("counts calls, keeps free sources out of the units and sizes per account", () => {
    const rows = [
      { datePt: "2026-10-01", method: "commentThreads.list", units: 1, accountId: "a" },
      { datePt: "2026-10-01", method: "commentThreads.list", units: 1, accountId: "a" },
      { datePt: "2026-10-01", method: "comments.insert", units: 50, accountId: "b" },
      { datePt: "2026-10-02", method: "comments.insert", units: 50, accountId: "b" },
      { datePt: "2026-10-02", method: "free:rss.feed", units: 0, accountId: "a" },
      { datePt: "2026-10-02", method: "free:rss.feed", units: 0, accountId: "a" },
      { datePt: "2026-10-03", method: "free:websub.push", units: 0, accountId: "b" },
    ];
    const sizing = sizeQuota(rows, 2);
    expect(sizing.days).toBe(2);
    expect(sizing.totalUnits).toBe(102);
    expect(sizing.byMethod).toEqual([
      { method: "comments.insert", units: 100, calls: 2, share: 100 / 102 },
      { method: "commentThreads.list", units: 2, calls: 2, share: 2 / 102 },
    ]);
    expect(sizing.free).toEqual([
      { method: "free:rss.feed", calls: 2 },
      { method: "free:websub.push", calls: 1 },
    ]);
    expect(sizing.perAccount).toEqual({ accounts: 2, median: 2, max: 50 });
  });
});
