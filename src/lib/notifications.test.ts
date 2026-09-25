import { describe, expect, it } from "vitest";
import { newMilestones, renewalRecapDue, weekHasActivity, weeklyEmailDue } from "./notifications";
import type { Report } from "./report";

function report(totals: Partial<Report["totals"]>): Report {
  return {
    period: "all_time",
    fromDay: null,
    toDay: "2026-09-28",
    currency: "USD",
    totals: { comments: 0, replies: 0, clicks: 0, subscribers: 0, buyers: 0, revenueCents: 0, recurringCents: 0, buyersWithoutAmount: 0, otherCurrencies: [], ...totals },
    byVideo: [],
    byKeyword: [],
    byTemplate: [],
    byIntent: [],
    byReplyTime: [],
  };
}

describe("milestones", () => {
  it("announces each first once", () => {
    expect(newMilestones(report({ clicks: 3, subscribers: 1 }), {})).toEqual(["first_click", "first_subscriber"]);
    expect(newMilestones(report({ clicks: 3, subscribers: 1, buyers: 1 }), { first_click: "x", first_subscriber: "x" })).toEqual(["first_buyer"]);
    expect(newMilestones(report({}), {})).toEqual([]);
  });
});

describe("weekly email", () => {
  // 2026-09-28 is a Monday.
  it("goes out on Monday from 9:00 in the creator's zone, once a week", () => {
    expect(weeklyEmailDue(new Date("2026-09-28T09:05:00Z"), "UTC", null)).toBe(true);
    expect(weeklyEmailDue(new Date("2026-09-28T08:59:00Z"), "UTC", null)).toBe(false);
    expect(weeklyEmailDue(new Date("2026-09-29T09:05:00Z"), "UTC", null)).toBe(false);
    // 16:00 UTC Monday is 9:00 Monday in Los Angeles.
    expect(weeklyEmailDue(new Date("2026-09-28T16:00:00Z"), "America/Los_Angeles", null)).toBe(true);
    expect(weeklyEmailDue(new Date("2026-09-28T10:00:00Z"), "UTC", new Date("2026-09-28T09:00:00Z"))).toBe(false);
    expect(weeklyEmailDue(new Date("2026-09-28T10:00:00Z"), "UTC", new Date("2026-09-21T09:00:00Z"))).toBe(true);
  });

  it("skips weeks without activity", () => {
    expect(weekHasActivity(report({}))).toBe(false);
    expect(weekHasActivity(report({ clicks: 1 }))).toBe(true);
  });
});

describe("renewal recap", () => {
  const paid = new Date("2025-10-10T12:00:00Z");
  it("is due once in the week that starts 14 days before the renewal", () => {
    expect(renewalRecapDue(paid, new Date("2026-09-25T12:00:00Z"), {})).toBeNull();
    expect(renewalRecapDue(paid, new Date("2026-09-27T12:00:00Z"), {})).toBe("2026-10-10");
    expect(renewalRecapDue(paid, new Date("2026-09-27T12:00:00Z"), { renewal_recap_for: "2026-10-10" })).toBeNull();
    expect(renewalRecapDue(paid, new Date("2026-10-04T12:00:00Z"), {})).toBeNull();
    expect(renewalRecapDue(null, new Date(), {})).toBeNull();
  });
});
