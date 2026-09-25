import { describe, expect, it } from "vitest";
import { hmacSha256Hex } from "@/lib/crypto";
import { authorizeProvisioning, provisioningPayloadSchema } from "./payload";

const secret = "provisioning-secret";
const body = JSON.stringify({ event: "purchase", external_id: "ord_1", email: "a@b.co", plan_code: "founding" });

describe("authorizeProvisioning", () => {
  it("accepts the bearer secret", () => {
    expect(authorizeProvisioning({ authorization: `Bearer ${secret}`, signature: null }, body, secret)).toBe(true);
  });

  it("rejects a missing or wrong bearer secret", () => {
    expect(authorizeProvisioning({ authorization: null, signature: null }, body, secret)).toBe(false);
    expect(authorizeProvisioning({ authorization: "Bearer nope", signature: null }, body, secret)).toBe(false);
    expect(authorizeProvisioning({ authorization: secret, signature: null }, body, secret)).toBe(false);
  });

  it("verifies an X-Signature when one is sent", () => {
    const good = hmacSha256Hex(body, secret);
    expect(authorizeProvisioning({ authorization: `Bearer ${secret}`, signature: good }, body, secret)).toBe(true);
    expect(authorizeProvisioning({ authorization: `Bearer ${secret}`, signature: `sha256=${good}` }, body, secret)).toBe(true);
    expect(authorizeProvisioning({ authorization: `Bearer ${secret}`, signature: "00".repeat(32) }, body, secret)).toBe(false);
    expect(authorizeProvisioning({ authorization: `Bearer ${secret}`, signature: good }, `${body} `, secret)).toBe(false);
  });
});

describe("provisioningPayloadSchema", () => {
  it("parses a GHL body and treats empty merge fields as missing", () => {
    const parsed = provisioningPayloadSchema.parse({
      event: "trial_started",
      external_id: 12345,
      email: " Creator@Example.com ",
      name: "",
      plan_code: "standard_monthly",
      subscription_id: "",
      trial_ends_at: "2026-10-09T00:00:00Z",
    });
    expect(parsed.external_id).toBe("12345");
    expect(parsed.email).toBe("Creator@Example.com");
    expect(parsed.name).toBeUndefined();
    expect(parsed.subscription_id).toBeUndefined();
    expect(parsed.trial_ends_at?.toISOString()).toBe("2026-10-09T00:00:00.000Z");
  });

  it("rejects unknown events, missing ids and bad emails", () => {
    expect(provisioningPayloadSchema.safeParse({ event: "lifetime", external_id: "1", email: "a@b.co" }).success).toBe(false);
    expect(provisioningPayloadSchema.safeParse({ event: "purchase", external_id: "", email: "a@b.co" }).success).toBe(false);
    expect(provisioningPayloadSchema.safeParse({ event: "purchase", external_id: "1", email: "nope" }).success).toBe(false);
  });
});
