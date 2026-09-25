import { describe, expect, it } from "vitest";
import { keyLast4, keyProblem, mapCharge, type StripeCharge } from "./stripe";

const LIVE = `rk_live_${"a1B2".repeat(8)}`;
const created = Math.floor(new Date("2026-09-20T10:00:00Z").getTime() / 1000);

function charge(over: Partial<StripeCharge> = {}): StripeCharge {
  return { id: "ch_1", amount: 9700, amount_captured: 9700, amount_refunded: 0, currency: "usd", created, paid: true, status: "succeeded", livemode: true, ...over };
}

describe("keyProblem", () => {
  it("accepts a live restricted key only", () => {
    expect(keyProblem(LIVE)).toBeNull();
    expect(keyProblem(`  ${LIVE}  `)).toBeNull();
    expect(keyLast4(LIVE)).toBe(LIVE.slice(-4));
  });

  it("refuses secret keys, test keys and junk with a reason", () => {
    expect(keyProblem("sk_live_abcdefghijklmnopqrstuvwx")).toContain("full secret key");
    expect(keyProblem("rk_test_abcdefghijklmnopqrstuvwx")).toContain("test-mode");
    expect(keyProblem("")).toContain("Paste");
    expect(keyProblem("pk_live_abcdefghijklmnopqrstuvwx")).toContain("restricted key");
    expect(keyProblem("rk_live_short")).toContain("restricted key");
  });
});

describe("mapCharge", () => {
  it("maps a paid charge with its customer, email, tracking id and subscription", () => {
    const mapped = mapCharge(
      charge({
        customer: { id: "cus_1", email: "  Ann@Example.com ", name: "Ann", metadata: {} },
        invoice: { id: "in_1", subscription: "sub_1" },
        metadata: { c2c_tid: "AbCdEfGhIj" },
        amount_refunded: 2000,
      }),
    );
    expect(mapped).toEqual({
      externalId: "ch_1",
      email: "ann@example.com",
      name: "Ann",
      tid: "AbCdEfGhIj",
      customerId: "cus_1",
      amountCents: 9700,
      currency: "USD",
      refundedCents: 2000,
      subscriptionId: "sub_1",
      occurredAt: new Date(created * 1000),
    });
  });

  it("falls back from the customer email to the billing email to the receipt email", () => {
    expect(mapCharge(charge({ customer: "cus_2", billing_details: { email: "Bill@Example.com" }, receipt_email: "r@example.com" }))).toMatchObject({ email: "bill@example.com", customerId: "cus_2" });
    expect(mapCharge(charge({ receipt_email: "R@Example.com" }))!.email).toBe("r@example.com");
    expect(mapCharge(charge({ customer: { id: "cus_3", email: "not an email" }, receipt_email: "ok@example.com" }))!.email).toBe("ok@example.com");
    expect(mapCharge(charge())!.email).toBeNull();
  });

  it("reads the subscription from both API shapes and the tid from the customer metadata", () => {
    const basil = mapCharge(charge({ invoice: { id: "in_2", parent: { subscription_details: { subscription: "sub_9" } } }, customer: { id: "cus_4", metadata: { c2c_tid: "ZyXwVuTsRq" } } }));
    expect(basil).toMatchObject({ subscriptionId: "sub_9", tid: "ZyXwVuTsRq" });
    expect(mapCharge(charge({ invoice: "in_only_an_id" }))!.subscriptionId).toBeNull();
  });

  it("drops a tracking id that is not one of ours", () => {
    expect(mapCharge(charge({ metadata: { c2c_tid: "not-a-tid!" } }))!.tid).toBeNull();
  });

  it("caps refunds at the amount and uses the captured amount", () => {
    expect(mapCharge(charge({ amount: 10000, amount_captured: 5000, amount_refunded: 9000 }))).toMatchObject({ amountCents: 5000, refundedCents: 5000 });
  });

  it("skips what is not a payment: failed, unpaid, test mode, zero, unknown currency", () => {
    expect(mapCharge(charge({ status: "failed", paid: false }))).toBeNull();
    expect(mapCharge(charge({ paid: false }))).toBeNull();
    expect(mapCharge(charge({ status: "pending" }))).toBeNull();
    expect(mapCharge(charge({ livemode: false }))).toBeNull();
    expect(mapCharge(charge({ amount: 0, amount_captured: 0 }))).toBeNull();
    expect(mapCharge(charge({ currency: "xx" }))).toBeNull();
  });
});
