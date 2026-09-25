import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, hmacSha256Hex, safeEqual, sha256Hex } from "./crypto";

const key = randomBytes(32).toString("base64");

describe("encryptSecret / decryptSecret", () => {
  it("round-trips and uses a fresh IV each time", () => {
    const a = encryptSecret("refresh-token-123", key);
    const b = encryptSecret("refresh-token-123", key);
    expect(a).toMatch(/^v1:/);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, key)).toBe("refresh-token-123");
  });

  it("rejects tampered ciphertext", () => {
    const value = encryptSecret("secret", key);
    const raw = Buffer.from(value.slice(3), "base64");
    raw[raw.length - 1] = raw[raw.length - 1]! ^ 1;
    expect(() => decryptSecret(`v1:${raw.toString("base64")}`, key)).toThrow();
  });

  it("rejects a different key", () => {
    const value = encryptSecret("secret", key);
    expect(() => decryptSecret(value, randomBytes(32).toString("base64"))).toThrow();
  });

  it("rejects keys that are not 32 bytes", () => {
    expect(() => encryptSecret("x", randomBytes(16).toString("base64"))).toThrow(/32 bytes/);
  });

  it("rejects unknown versions", () => {
    expect(() => decryptSecret("v9:abc", key)).toThrow(/version/);
  });
});

describe("hashing and comparison", () => {
  it("hashes deterministically", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("computes HMAC-SHA256 hex", () => {
    expect(hmacSha256Hex("body", "secret")).toHaveLength(64);
    expect(hmacSha256Hex("body", "secret")).toBe(hmacSha256Hex("body", "secret"));
    expect(hmacSha256Hex("body", "secret")).not.toBe(hmacSha256Hex("body2", "secret"));
  });

  it("compares safely, including different lengths", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});
