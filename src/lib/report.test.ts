import { describe, expect, it } from "vitest";
import { buildHeadline, buildReport, monthlyPriceCents, periodRange, type PurchaseFact, type ReportInput, templateKeyOf } from "./report";

const NOW = new Date("2026-09-25T18:00:00Z");
const d = (iso: string) => new Date(iso);
const dims = (over: Partial<{ videoId: string | null; keyword: string | null; intent: string | null; templateKey: string }> = {}) => ({
  videoId: "vidA",
  keyword: "guide",
  intent: "hot",
  templateKey: "tpl1",
  ...over,
});

function purchase(over: Partial<PurchaseFact> = {}): PurchaseFact {
  return { ...dims(), buyer: "ann@example.com", replyId: "r1", attributed: true, netCents: 9700, currency: "USD", recurring: false, occurredAt: d("2026-09-20T10:00:00Z"), ...over };
}

function input(over: Partial<ReportInput> = {}): ReportInput {
  return {
    replies: [
      { ...dims(), id: "r1", createdAt: d("2026-09-20T08:00:00Z"), sentAt: d("2026-09-20T08:30:00Z") },
      { ...dims({ videoId: "vidB", keyword: "plan", intent: "warm", templateKey: "ai" }), id: "r2", createdAt: d("2026-09-21T08:00:00Z"), sentAt: d("2026-09-22T09:00:00Z") },
      { ...dims(), id: "r3", createdAt: d("2026-08-01T08:00:00Z"), sentAt: null },
    ],
    clicks: [
      { ...dims(), replyId: "r1", day: "2026-09-20", count: 3 },
      { ...dims({ videoId: "vidB", keyword: "plan", intent: "warm", templateKey: "ai" }), replyId: "r2", day: "2026-09-22", count: 2 },
      { ...dims({ templateKey: "static", intent: null }), replyId: null, day: "2026-07-01", count: 5 },
    ],
    subscribers: [
      { ...dims(), email: "ann@example.com", replyId: "r1", occurredAt: d("2026-09-20T09:00:00Z") },
      { ...dims(), email: "ann@example.com", replyId: "r1", occurredAt: d("2026-09-20T09:05:00Z") },
      { ...dims({ videoId: "vidB", keyword: "plan", intent: "warm", templateKey: "ai" }), email: "bob@example.com", replyId: "r2", occurredAt: d("2026-09-22T10:00:00Z") },
    ],
    purchases: [
      purchase(),
      purchase({ occurredAt: d("2026-09-21T10:00:00Z"), netCents: 2000, recurring: true }),
      purchase({ buyer: "bob@example.com", replyId: "r2", ...dims({ videoId: "vidB", keyword: "plan", intent: "warm", templateKey: "ai" }), netCents: null, currency: null }),
      purchase({ buyer: "eve@example.com", netCents: 5000, currency: "EUR" }),
      purchase({ buyer: "zed@example.com", attributed: false, netCents: 100000 }),
    ],
    ...over,
  };
}

describe("periodRange", () => {
  it("uses calendar days in the account's time zone", () => {
    expect(periodRange("this_month", NOW, "UTC")).toEqual({ fromDay: "2026-09-01", toDay: "2026-09-25" });
    expect(periodRange("last_30", NOW, "UTC")).toEqual({ fromDay: "2026-08-27", toDay: "2026-09-25" });
    expect(periodRange("all_time", NOW, "UTC").fromDay).toBeNull();
    // 01:30 on October 1 in Singapore is still September 30 in UTC.
    expect(periodRange("this_month", d("2026-09-30T17:30:00Z"), "Asia/Singapore").fromDay).toBe("2026-10-01");
  });
});

describe("buildReport", () => {
  const report = buildReport(input(), { period: "this_month", now: NOW, timeZone: "UTC", currency: "USD" });

  it("counts the funnel: comments, replies, clicks, unique subscribers and buyers, revenue once", () => {
    expect(report.totals).toMatchObject({ comments: 2, replies: 2, clicks: 5, subscribers: 2, buyers: 3, revenueCents: 11700, recurringCents: 2000, buyersWithoutAmount: 1 });
    expect(report.totals.otherCurrencies).toEqual([{ currency: "EUR", revenueCents: 5000 }]);
  });

  it("splits by video, keyword with intent, template and intent", () => {
    expect(report.byVideo.map((r) => [r.key, r.revenueCents, r.buyers])).toEqual([
      ["vidA", 11700, 2],
      ["vidB", 0, 1],
    ]);
    expect(report.byKeyword[0]).toMatchObject({ key: "guide", intent: "hot", clicks: 3, subscribers: 1, replies: 1 });
    expect(report.byTemplate.map((r) => r.key)).toEqual(["tpl1", "ai"]);
    expect(report.byIntent.map((r) => r.key)).toEqual(["hot", "warm"]);
  });

  it("groups posted replies by time to reply with what they led to", () => {
    const fast = report.byReplyTime.find((b) => b.key === "under_1h")!;
    const slow = report.byReplyTime.find((b) => b.key === "over_24h")!;
    expect(fast).toMatchObject({ replies: 1, clicks: 3, subscribers: 1, buyers: 2, revenueCents: 11700 });
    expect(slow).toMatchObject({ replies: 1, clicks: 2, subscribers: 1, buyers: 1, revenueCents: 0 });
    expect(report.byReplyTime).toHaveLength(4);
  });

  it("includes older data only in the longer periods", () => {
    const all = buildReport(input(), { period: "all_time", now: NOW, timeZone: "UTC", currency: "USD" });
    expect(all.totals.comments).toBe(3);
    expect(all.totals.clicks).toBe(10);
    expect(all.byTemplate.find((r) => r.key === "static")?.clicks).toBe(5);
  });

  it("reports in the chosen currency and lists the others unconverted", () => {
    const eur = buildReport(input(), { period: "this_month", now: NOW, timeZone: "UTC", currency: "EUR" });
    expect(eur.totals.revenueCents).toBe(5000);
    expect(eur.totals.otherCurrencies).toEqual([{ currency: "USD", revenueCents: 11700 }]);
  });
});

describe("headline", () => {
  const month = buildReport(input(), { period: "this_month", now: NOW, timeZone: "UTC", currency: "USD" });
  const all = buildReport(input(), { period: "all_time", now: NOW, timeZone: "UTC", currency: "USD" });

  it("shows this month, lifetime, the recurring part and the subscription share", () => {
    const h = buildHeadline(month, all, { billing: "annual", priceCents: 9700, priceCurrency: "USD" });
    expect(h).toMatchObject({ thisMonthCents: 11700, lifetimeCents: 11700, recurringThisMonthCents: 2000, subscriptionMonthlyCents: 808 });
    expect(h.subscriptionPercent).toBeCloseTo(6.906, 2);
    expect(h.roiMultiple).toBeCloseTo(14.48, 1);
  });

  it("omits the share on free plans, without revenue and across currencies", () => {
    expect(buildHeadline(month, all, { billing: "free_grant", priceCents: null, priceCurrency: null }).subscriptionPercent).toBeNull();
    const none = buildReport(input({ purchases: [] }), { period: "this_month", now: NOW, timeZone: "UTC", currency: "USD" });
    expect(buildHeadline(none, none, { billing: "monthly", priceCents: 4900, priceCurrency: "USD" }).subscriptionPercent).toBeNull();
    expect(buildHeadline(month, all, { billing: "monthly", priceCents: 4900, priceCurrency: "EUR" }).roiMultiple).toBeNull();
  });

  it("turns plan prices into a monthly amount", () => {
    expect(monthlyPriceCents({ billing: "monthly", priceCents: 4900 })).toBe(4900);
    expect(monthlyPriceCents({ billing: "annual", priceCents: 9700 })).toBe(808);
    expect(monthlyPriceCents({ billing: "custom", priceCents: 50000 })).toBeNull();
    expect(monthlyPriceCents({ billing: "monthly", priceCents: null })).toBeNull();
  });
});

describe("templateKeyOf", () => {
  it("names the source of a reply", () => {
    expect(templateKeyOf(null)).toBe("static");
    expect(templateKeyOf({ draftSource: "ai", templateId: "t1" })).toBe("ai");
    expect(templateKeyOf({ draftSource: "template", templateId: "t1" })).toBe("t1");
    expect(templateKeyOf({ draftSource: "template", templateId: null })).toBe("fallback");
  });
});
