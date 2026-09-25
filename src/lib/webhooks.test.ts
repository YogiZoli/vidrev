import { describe, expect, it } from "vitest";
import { buildEventPayload, nextAttemptAt, RETRY_DELAYS_SECONDS, signBody, verifySignature } from "./webhooks";

const at = new Date("2026-09-25T10:00:00Z");

describe("event payloads", () => {
  it("builds a click payload with tags and no personal data", () => {
    const payload = buildEventPayload({
      event: "link_clicked",
      id: "e1",
      occurredAt: at,
      accountId: "a1",
      context: { channelId: "c1", videoId: "dQw4w9WgXcQ", campaignId: "k1", campaign: "Guide", keyword: "GUIDE", intent: "hot", tid: "tid1", email: "x@y.com" },
    });
    expect(payload).toMatchObject({
      event: "link_clicked",
      id: "e1",
      occurred_at: "2026-09-25T10:00:00.000Z",
      account_id: "a1",
      channel_id: "c1",
      video_id: "dQw4w9WgXcQ",
      keyword: "GUIDE",
      tid: "tid1",
      tags: ["c2c", "c2c_kw_guide", "c2c_vid_dQw4w9WgXcQ"],
    });
    expect(payload).not.toHaveProperty("email");
    expect(payload).not.toHaveProperty("amount_cents");
  });

  it("adds email and source on opt_in, amount and buyer tag on purchase", () => {
    const optIn = buildEventPayload({ event: "opt_in", id: "e", occurredAt: at, accountId: "a", context: { email: "a@b.com", source: "webhook", keyword: "k" } });
    expect(optIn).toMatchObject({ email: "a@b.com", source: "webhook" });
    expect(optIn).not.toHaveProperty("amount_cents");
    const purchase = buildEventPayload({
      event: "purchase",
      id: "e",
      occurredAt: at,
      accountId: "a",
      context: { email: "a@b.com", amountCents: 9700, currency: "USD", keyword: "k", buyer: true },
    });
    expect(purchase).toMatchObject({ amount_cents: 9700, currency: "USD" });
    expect(purchase.tags).toEqual(["c2c", "c2c_kw_k", "c2c_buyer"]);
  });

  it("keeps the amount null when the source did not report one", () => {
    const purchase = buildEventPayload({ event: "purchase", id: "e", occurredAt: at, accountId: "a", context: { email: "a@b.com" } });
    expect(purchase.amount_cents).toBeNull();
  });

  it("ping carries no campaign data", () => {
    expect(buildEventPayload({ event: "ping", id: "e", occurredAt: at, accountId: "a" })).toEqual({
      event: "ping",
      id: "e",
      occurred_at: "2026-09-25T10:00:00.000Z",
      account_id: "a",
    });
  });
});

describe("signing", () => {
  const body = '{"event":"opt_in"}';

  it("signs and verifies the raw body", () => {
    const header = signBody(body, "whsec_secret");
    expect(header).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(verifySignature(body, header, "whsec_secret")).toBe(true);
  });

  it("accepts the bare hex form", () => {
    expect(verifySignature(body, signBody(body, "s").slice(7), "s")).toBe(true);
  });

  it("rejects a changed body, wrong secret and missing header", () => {
    const header = signBody(body, "s");
    expect(verifySignature(`${body} `, header, "s")).toBe(false);
    expect(verifySignature(body, header, "other")).toBe(false);
    expect(verifySignature(body, null, "s")).toBe(false);
    expect(verifySignature(body, "sha256=abc", "s")).toBe(false);
  });
});

describe("retry schedule", () => {
  const created = new Date("2026-09-25T10:00:00Z");

  it("backs off and stops inside 24 hours", () => {
    let now = created;
    let attempts = 0;
    const times: number[] = [];
    for (;;) {
      attempts += 1;
      const next = nextAttemptAt(attempts, created, now);
      if (!next) break;
      times.push(next.getTime() - now.getTime());
      now = next;
    }
    expect(times).toEqual(RETRY_DELAYS_SECONDS.map((s) => s * 1000));
    expect(attempts).toBe(8);
    expect(now.getTime() - created.getTime()).toBeLessThan(24 * 3_600_000);
  });

  it("gives up when the next attempt would pass 24 hours", () => {
    const late = new Date(created.getTime() + 20 * 3_600_000);
    expect(nextAttemptAt(7, created, late)).toBeNull();
    expect(nextAttemptAt(1, created, late)).not.toBeNull();
  });
});
