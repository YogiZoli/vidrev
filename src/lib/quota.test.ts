import { describe, expect, it } from "vitest";
import { canSpendOnRead, canSpendOnReply, nextPollAt, pollTier, readBudget, repliesLeftToday, stretchFactor } from "./quota";

const now = new Date("2026-09-25T12:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);

describe("quota budget", () => {
  it("keeps 75% of the day for replies", () => {
    expect(readBudget(10_000, 75)).toBe(2500);
    expect(canSpendOnRead({ reads: 2499, replies: 0 }, 10_000, 75)).toBe(true);
    expect(canSpendOnRead({ reads: 2500, replies: 0 }, 10_000, 75)).toBe(false);
  });

  it("lets replies use everything left of the day, reads never the reserve", () => {
    expect(canSpendOnReply({ reads: 100, replies: 9850 }, 10_000)).toBe(true);
    expect(canSpendOnReply({ reads: 100, replies: 9851 }, 10_000)).toBe(false);
    expect(canSpendOnRead({ reads: 10, replies: 9990 }, 10_000, 75)).toBe(false);
    expect(repliesLeftToday({ reads: 2500, replies: 0 }, 10_000)).toBe(150);
  });
});

describe("poll tiers", () => {
  it("polls fast inside the 48h upload window", () => {
    expect(pollTier({ freshUntil: new Date(now.getTime() + 1000), lastUploadAt: hoursAgo(1) }, now)).toBe("fresh");
  });

  it("polls hourly when nothing was uploaded for 14 days", () => {
    expect(pollTier({ freshUntil: hoursAgo(300), lastUploadAt: hoursAgo(15 * 24) }, now)).toBe("quiet");
    expect(pollTier({ freshUntil: null, lastUploadAt: hoursAgo(13 * 24) }, now)).toBe("normal");
    expect(pollTier({ freshUntil: null, lastUploadAt: null }, now)).toBe("normal");
  });

  it("stretches all intervals only when the read budget is exceeded", () => {
    expect(stretchFactor(["normal", "normal"], 2500)).toBe(1);
    // 100 fresh channels need 72,000 polls a day against 2,000 usable units.
    expect(stretchFactor(Array(100).fill("fresh"), 2500)).toBeCloseTo(36);
    expect(stretchFactor(["normal"], 0)).toBe(96);
    expect(nextPollAt("fresh", 36, now).getTime() - now.getTime()).toBe(72 * 60_000);
  });
});
