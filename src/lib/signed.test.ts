import { describe, expect, it } from "vitest";
import { signValue, verifySignedValue } from "./signed";

const now = new Date("2026-09-25T12:00:00Z");
const later = new Date(now.getTime() + 60_000);

describe("signed values", () => {
  it("round-trips before expiry", () => {
    const value = signValue({ state: "s1", verifier: "v1" }, "secret", later);
    expect(verifySignedValue<{ state: string }>(value, "secret", now)?.state).toBe("s1");
  });

  it("rejects expired values", () => {
    const value = signValue({ state: "s1" }, "secret", later);
    expect(verifySignedValue(value, "secret", new Date(later.getTime() + 1))).toBeNull();
  });

  it("rejects a wrong secret or a modified body", () => {
    const value = signValue({ state: "s1" }, "secret", later);
    expect(verifySignedValue(value, "other", now)).toBeNull();
    const [, signature] = value.split(".");
    const forged = Buffer.from(JSON.stringify({ state: "s2", exp: later.getTime() })).toString("base64url");
    expect(verifySignedValue(`${forged}.${signature}`, "secret", now)).toBeNull();
  });

  it("rejects missing or malformed input", () => {
    expect(verifySignedValue(undefined, "secret", now)).toBeNull();
    expect(verifySignedValue("garbage", "secret", now)).toBeNull();
  });
});
