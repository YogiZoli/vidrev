import { describe, expect, it } from "vitest";
import { checkReplyAllowance, foundingThresholdsReached, PLAN_CODES, PLAN_SEEDS } from "./plans";

describe("plan seeds", () => {
  it("defines every required plan exactly once and no lifetime plan", () => {
    expect(PLAN_SEEDS.map((p) => p.code).sort()).toEqual([...PLAN_CODES].sort());
    expect(PLAN_SEEDS.some((p) => p.code.includes("lifetime"))).toBe(false);
  });

  it("gives standard, founding and partner access the same caps (Q-03)", () => {
    for (const code of ["standard_monthly", "founding", "ghl_affiliate_free"]) {
      const plan = PLAN_SEEDS.find((p) => p.code === code)!;
      expect(plan.monthlyReplyCap).toBe(300);
      expect(plan.dailyReplyCap).toBe(30);
      expect(plan.channelLimit).toBe(1);
    }
  });

  it("caps founding seats at 100 at 97 USD per year", () => {
    const founding = PLAN_SEEDS.find((p) => p.code === "founding")!;
    expect(founding.seatsCap).toBe(100);
    expect(founding.billing).toBe("annual");
    expect(founding.priceLabel).toBe("$97/year");
  });
});

describe("checkReplyAllowance", () => {
  const caps = { monthlyReplyCap: 300, dailyReplyCap: 30 };

  it("allows replies below both caps", () => {
    expect(checkReplyAllowance(caps, { thisMonth: 0, today: 0 })).toEqual({ ok: true });
    expect(checkReplyAllowance(caps, { thisMonth: 299, today: 29 })).toEqual({ ok: true });
  });

  it("stops at the monthly cap", () => {
    expect(checkReplyAllowance(caps, { thisMonth: 300, today: 0 })).toEqual({ ok: false, reason: "monthly_cap" });
  });

  it("stops at the daily safety ceiling even with room in the month", () => {
    expect(checkReplyAllowance(caps, { thisMonth: 40, today: 30 })).toEqual({ ok: false, reason: "daily_cap" });
  });

  it("reports the monthly cap first when both are reached", () => {
    expect(checkReplyAllowance(caps, { thisMonth: 300, today: 30 })).toEqual({ ok: false, reason: "monthly_cap" });
  });

  it("treats null as no cap", () => {
    expect(checkReplyAllowance({ monthlyReplyCap: null, dailyReplyCap: null }, { thisMonth: 10_000, today: 1_000 })).toEqual({ ok: true });
    expect(checkReplyAllowance({ monthlyReplyCap: null, dailyReplyCap: 30 }, { thisMonth: 10_000, today: 30 })).toEqual({
      ok: false,
      reason: "daily_cap",
    });
  });
});

describe("founding seat alerts", () => {
  it("fires at 90 and 100", () => {
    expect(foundingThresholdsReached(89)).toEqual([]);
    expect(foundingThresholdsReached(90)).toEqual([90]);
    expect(foundingThresholdsReached(100)).toEqual([90, 100]);
    expect(foundingThresholdsReached(104)).toEqual([90, 100]);
  });
});
