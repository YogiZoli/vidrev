import { describe, expect, it } from "vitest";
import { hashPassword, passwordProblem, verifyAgainstDummy, verifyPassword } from "./password";

describe("password", () => {
  it("hashes with a salt and verifies", async () => {
    const a = await hashPassword("correct horse");
    const b = await hashPassword("correct horse");
    expect(a).not.toBe(b);
    expect(a.startsWith("scrypt$32768$8$1$")).toBe(true);
    expect(await verifyPassword("correct horse", a)).toBe(true);
    expect(await verifyPassword("wrong horse", a)).toBe(false);
  });

  it("refuses missing or malformed hashes", async () => {
    expect(await verifyPassword("x", null)).toBe(false);
    expect(await verifyPassword("x", "md5$abc")).toBe(false);
    expect(await verifyAgainstDummy("x")).toBe(false);
  });

  it("checks length", () => {
    expect(passwordProblem("short")).toMatch(/at least 8/);
    expect(passwordProblem("long enough")).toBeNull();
  });
});
