import { describe, expect, it } from "vitest";
import { parseBody, parseOptIn, parsePurchase, readTid } from "./inbound";

const now = new Date("2026-09-25T12:00:00Z");

describe("tracking id", () => {
  it("reads tid, vidrev_tid and utm_content, in that order", () => {
    expect(readTid({ tid: "k3x9Tq2mPz" })).toBe("k3x9Tq2mPz");
    expect(readTid({ vidrev_tid: "k3x9Tq2mPz" })).toBe("k3x9Tq2mPz");
    expect(readTid({ utm_content: "k3x9Tq2mPz" })).toBe("k3x9Tq2mPz");
    expect(readTid({ tid: "AAAAAAAAAA", utm_content: "BBBBBBBBBB" })).toBe("AAAAAAAAAA");
  });

  it("drops values that are not one of ours", () => {
    expect(readTid({ utm_content: "spring-sale" })).toBeNull();
    expect(readTid({ tid: "short" })).toBeNull();
    expect(readTid({ tid: "k3x9Tq2mPz; drop table" })).toBeNull();
    expect(readTid({})).toBeNull();
  });
});

describe("opt-in payload", () => {
  it("normalizes the email and reads aliases", () => {
    const result = parseOptIn({ email: "  Ann@Example.COM ", first_name: "Ann", last_name: "Lee", vidrev_tid: "k3x9Tq2mPz", marketing_consent: "yes", submission_id: 42 }, now);
    expect(result).toEqual({
      ok: true,
      value: { email: "ann@example.com", name: "Ann Lee", tid: "k3x9Tq2mPz", externalId: "42", consentMarketing: true, occurredAt: now },
    });
  });

  it("leaves consent unknown unless the source says", () => {
    const result = parseOptIn({ email: "a@b.com" }, now);
    expect(result.ok && result.value.consentMarketing).toBeNull();
    const no = parseOptIn({ email: "a@b.com", consent_marketing: false }, now);
    expect(no.ok && no.value.consentMarketing).toBe(false);
  });

  it("needs a valid email", () => {
    expect(parseOptIn({}, now)).toMatchObject({ ok: false });
    expect(parseOptIn({ email: "nope" }, now)).toMatchObject({ ok: false });
  });

  it("takes a past timestamp, ignores a future one", () => {
    const past = parseOptIn({ email: "a@b.com", occurred_at: "2026-09-20T08:00:00Z" }, now);
    expect(past.ok && past.value.occurredAt.toISOString()).toBe("2026-09-20T08:00:00.000Z");
    const future = parseOptIn({ email: "a@b.com", occurred_at: "2027-01-01T00:00:00Z" }, now);
    expect(future.ok && future.value.occurredAt).toEqual(now);
    const unix = parseOptIn({ email: "a@b.com", timestamp: "1790000000" }, now);
    expect(unix.ok && unix.value.occurredAt.getTime()).toBe(1_790_000_000_000);
  });
});

describe("purchase payload", () => {
  it("reads a decimal amount with currency", () => {
    const result = parsePurchase({ email: "B@x.com", external_id: "ord_1", amount: "97.00", currency: "usd", subscription_id: "sub_9" }, now);
    expect(result).toEqual({
      ok: true,
      value: { email: "b@x.com", tid: null, externalId: "ord_1", amountCents: 9700, currency: "USD", refundedCents: null, subscriptionId: "sub_9", occurredAt: now },
    });
  });

  it("reads cents directly", () => {
    const result = parsePurchase({ email: "b@x.com", external_id: "o", amount_cents: 4900, currency: "EUR" }, now);
    expect(result.ok && result.value.amountCents).toBe(4900);
  });

  it("allows a buyer without an amount", () => {
    const result = parsePurchase({ email: "b@x.com", external_id: "o" }, now);
    expect(result).toMatchObject({ ok: true, value: { amountCents: null, currency: null } });
  });

  it("needs an id, an email or tid, and a currency with any amount", () => {
    expect(parsePurchase({ email: "b@x.com" }, now)).toMatchObject({ ok: false });
    expect(parsePurchase({ external_id: "o" }, now)).toMatchObject({ ok: false });
    expect(parsePurchase({ external_id: "o", tid: "k3x9Tq2mPz" }, now)).toMatchObject({ ok: true });
    expect(parsePurchase({ email: "b@x.com", external_id: "o", amount: "10" }, now)).toMatchObject({ ok: false });
    expect(parsePurchase({ email: "b@x.com", external_id: "o", amount_cents: 1000 }, now)).toMatchObject({ ok: false });
    expect(parsePurchase({ email: "b@x.com", external_id: "o", amount: "1,000", currency: "USD" }, now)).toMatchObject({ ok: false });
  });

  it("reads refunds", () => {
    const partial = parsePurchase({ email: "b@x.com", external_id: "o", amount: "100", refunded_amount: "40", currency: "USD" }, now);
    expect(partial.ok && partial.value.refundedCents).toBe(4000);
    expect(parsePurchase({ email: "b@x.com", external_id: "o", type: "refund" }, now)).toMatchObject({ ok: false });
    const refund = parsePurchase({ email: "b@x.com", external_id: "o", type: "refund", refunded_cents: 10000, currency: "USD" }, now);
    expect(refund.ok && refund.value.refundedCents).toBe(10000);
  });
});

describe("body parsing", () => {
  it("parses JSON and form posts", () => {
    expect(parseBody('{"email":"a@b.com"}', "application/json; charset=utf-8")).toEqual({ ok: true, fields: { email: "a@b.com" } });
    expect(parseBody("email=a%40b.com&tid=k3x9Tq2mPz", "application/x-www-form-urlencoded")).toEqual({ ok: true, fields: { email: "a@b.com", tid: "k3x9Tq2mPz" } });
  });

  it("rejects arrays, junk and unknown types", () => {
    expect(parseBody("[1]", "application/json")).toMatchObject({ ok: false, status: 400 });
    expect(parseBody("{nope", "application/json")).toMatchObject({ ok: false, status: 400 });
    expect(parseBody("<xml/>", "application/xml")).toMatchObject({ ok: false, status: 415 });
  });
});
