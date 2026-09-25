import { describe, expect, it } from "vitest";
import { attributePurchases, groupDuplicates, lastTouchByEmail, type PurchaseFact, type Touch } from "./attribution";

const DAY = 86_400_000;
const T0 = new Date("2026-06-01T12:00:00Z");
const at = (days: number, extraMs = 0) => new Date(T0.getTime() + days * DAY + extraMs);

let seq = 0;
function purchase(over: Partial<PurchaseFact> = {}): PurchaseFact {
  seq += 1;
  return {
    id: `p${String(seq).padStart(3, "0")}`,
    source: "webhook",
    kind: "payment",
    emailNorm: "ann@example.com",
    tid: null,
    amountCents: 9700,
    currency: "USD",
    refundedCents: 0,
    subscriptionRef: null,
    occurredAt: at(0),
    createdAt: at(0),
    ...over,
  };
}

function touch(over: Partial<Touch> = {}): Touch {
  return { at: at(-1), clickId: "c1", replyId: "r1", campaignId: "k1", videoId: "vidA", keyword: "guide", intent: "hot", subscriberId: "s1", ...over };
}

const lookup = (clicks: Record<string, Touch> = {}, optIns: Record<string, Touch[]> = {}) => ({
  clickByTid: new Map(Object.entries(clicks)),
  optInsByEmail: new Map(Object.entries(optIns)),
});

describe("lastTouchByEmail", () => {
  it("takes the latest touch inside 180 days before the purchase", () => {
    const touches = [touch({ at: at(-200), videoId: "old" }), touch({ at: at(-30), videoId: "mid" }), touch({ at: at(-2), videoId: "last" })];
    expect(lastTouchByEmail(touches, at(0))?.videoId).toBe("last");
  });

  it("ignores touches after the purchase beyond the clock skew and before the window", () => {
    expect(lastTouchByEmail([touch({ at: at(0, 20 * 60_000) })], at(0))).toBeNull();
    expect(lastTouchByEmail([touch({ at: at(0, 5 * 60_000) })], at(0))).not.toBeNull();
    expect(lastTouchByEmail([touch({ at: at(-181) })], at(0))).toBeNull();
    expect(lastTouchByEmail([touch({ at: at(-180) })], at(0))).not.toBeNull();
    expect(lastTouchByEmail(undefined, at(0))).toBeNull();
  });
});

describe("groupDuplicates", () => {
  it("links the same sale from two sources to one canonical purchase, the CRM over the webhook", () => {
    const hook = purchase({ source: "webhook", occurredAt: at(0) });
    const ghl = purchase({ source: "ghl", occurredAt: at(0, 3_600_000) });
    const groups = groupDuplicates([hook, ghl]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.canonical.id).toBe(ghl.id);
  });

  it("matches by tracking id when one source has no email", () => {
    const hook = purchase({ source: "webhook", emailNorm: null, tid: "AbCdEfGhIj" });
    const ghl = purchase({ source: "ghl", tid: "AbCdEfGhIj" });
    expect(groupDuplicates([hook, ghl])).toHaveLength(1);
  });

  it("keeps different amounts, currencies, buyers, far apart dates and same-source rows apart", () => {
    const base = purchase({ source: "ghl" });
    expect(groupDuplicates([base, purchase({ amountCents: 9800 })])).toHaveLength(2);
    expect(groupDuplicates([base, purchase({ currency: "EUR" })])).toHaveLength(2);
    expect(groupDuplicates([base, purchase({ emailNorm: "bob@example.com" })])).toHaveLength(2);
    expect(groupDuplicates([base, purchase({ occurredAt: at(4) })])).toHaveLength(2);
    expect(groupDuplicates([base, purchase({ source: "ghl" })])).toHaveLength(2);
  });

  it("never merges buyer markers", () => {
    const marker = purchase({ source: "ghl", kind: "buyer_marker", amountCents: null, currency: null });
    expect(groupDuplicates([marker, purchase()])).toHaveLength(2);
  });

  it("takes one member per source, the closest in time", () => {
    const ghl = purchase({ source: "ghl", occurredAt: at(0) });
    const far = purchase({ source: "webhook", occurredAt: at(2) });
    const near = purchase({ source: "webhook", occurredAt: at(0, 60_000) });
    const groups = groupDuplicates([ghl, far, near]);
    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.canonical.id === ghl.id)!.members.map((m) => m.id).sort()).toEqual([ghl.id, near.id].sort());
  });
});

describe("attributePurchases", () => {
  it("prefers the purchase's own tracking id", () => {
    const p = purchase({ tid: "TIDaaaaaaa" });
    const click = touch({ at: at(-3), clickId: "cT", videoId: "fromTid", subscriberId: null });
    const optIn = touch({ at: at(-1), clickId: "cE", videoId: "fromEmail" });
    const result = attributePurchases([p], lookup({ TIDaaaaaaa: click }, { "ann@example.com": [optIn] })).get(p.id)!;
    expect(result.method).toBe("tid");
    expect(result.touch?.videoId).toBe("fromTid");
    expect(result.netCents).toBe(9700);
    expect(result.canonicalId).toBe(p.id);
  });

  it("links the opt-in that carried the same tracking id", () => {
    const p = purchase({ tid: "TIDaaaaaaa" });
    const click = touch({ clickId: "cT", subscriberId: null });
    const optIn = touch({ clickId: "cT", subscriberId: "sub9" });
    expect(attributePurchases([p], lookup({ TIDaaaaaaa: click }, { "ann@example.com": [optIn] })).get(p.id)!.touch?.subscriberId).toBe("sub9");
  });

  it("falls back to the last opt-in by email when the tracking id is unknown or too old", () => {
    const p = purchase({ tid: "TIDaaaaaaa" });
    const old = touch({ at: at(-200), videoId: "old" });
    const optIn = touch({ at: at(-10), videoId: "email" });
    const result = attributePurchases([p], lookup({ TIDaaaaaaa: old }, { "ann@example.com": [optIn] })).get(p.id)!;
    expect(result.method).toBe("email");
    expect(result.touch?.videoId).toBe("email");
    const none = attributePurchases([purchase({ tid: "TIDbbbbbbb" })], lookup()).values().next().value!;
    expect(none.method).toBeNull();
    expect(none.touch).toBeNull();
  });

  it("does not attribute without a touch inside the window", () => {
    const p = purchase();
    const result = attributePurchases([p], lookup({}, { "ann@example.com": [touch({ at: at(-181) })] })).get(p.id)!;
    expect(result.method).toBeNull();
    expect(result.netCents).toBe(9700);
  });

  it("subtracts refunds, and the largest refund of a duplicate group counts once", () => {
    const partly = purchase({ refundedCents: 2000 });
    expect(attributePurchases([partly], lookup()).get(partly.id)!.netCents).toBe(7700);
    const ghl = purchase({ source: "ghl", refundedCents: 0 });
    const hook = purchase({ source: "webhook", refundedCents: 9700 });
    const results = attributePurchases([ghl, hook], lookup());
    expect(results.get(ghl.id)!.netCents).toBe(0);
    expect(results.get(hook.id)!.netCents).toBe(0);
    expect(results.get(hook.id)!.canonicalId).toBe(ghl.id);
  });

  it("counts a duplicate's revenue once and gives both rows the same attribution", () => {
    const ghl = purchase({ source: "ghl" });
    const hook = purchase({ source: "webhook", tid: "TIDaaaaaaa" });
    const results = attributePurchases([ghl, hook], lookup({ TIDaaaaaaa: touch({ videoId: "v" }) }));
    expect(results.get(ghl.id)).toMatchObject({ netCents: 9700, method: "tid" });
    expect(results.get(hook.id)).toMatchObject({ netCents: 0, method: "tid", canonicalId: ghl.id });
  });

  it("keeps a buyer marker's revenue unreported but attributes the buyer", () => {
    const marker = purchase({ source: "ghl", kind: "buyer_marker", amountCents: null, currency: null });
    const result = attributePurchases([marker], lookup({}, { "ann@example.com": [touch()] })).get(marker.id)!;
    expect(result).toMatchObject({ netCents: null, method: "email", canonicalId: marker.id });
  });

  it("attributes every renewal to the first payment's touch, beyond 180 days (Q-07)", () => {
    const first = purchase({ subscriptionRef: "sub_1", occurredAt: at(0) });
    const renewal = purchase({ subscriptionRef: "sub_1", occurredAt: at(400) });
    const newer = touch({ at: at(399), videoId: "other" });
    const results = attributePurchases([renewal, first], lookup({}, { "ann@example.com": [touch({ at: at(-5), videoId: "first" }), newer] }));
    expect(results.get(first.id)).toMatchObject({ method: "email", touch: { videoId: "first" } });
    expect(results.get(renewal.id)).toMatchObject({ method: "subscription", touch: { videoId: "first" } });
  });

  it("leaves renewals unattributed when the first payment was not from a comment", () => {
    const first = purchase({ subscriptionRef: "sub_2", occurredAt: at(0) });
    const renewal = purchase({ subscriptionRef: "sub_2", occurredAt: at(30) });
    const results = attributePurchases([first, renewal], lookup({}, { "ann@example.com": [touch({ at: at(29) })] }));
    expect(results.get(first.id)!.method).toBeNull();
    expect(results.get(renewal.id)!.method).toBeNull();
  });

  it("needs a new touch for a separate purchase by the same buyer", () => {
    const p1 = purchase({ occurredAt: at(0) });
    const p2 = purchase({ occurredAt: at(300), amountCents: 50000 });
    const results = attributePurchases([p1, p2], lookup({}, { "ann@example.com": [touch({ at: at(-1) })] }));
    expect(results.get(p1.id)!.method).toBe("email");
    expect(results.get(p2.id)!.method).toBeNull();
  });
});
