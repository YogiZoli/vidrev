import { describe, expect, it } from "vitest";
import { parseTargetUrl, returnPath } from "./onboarding";

describe("parseTargetUrl", () => {
  it("accepts a full or bare address and normalises it", () => {
    expect(parseTargetUrl(" https://example.com/guide ")).toBe("https://example.com/guide");
    expect(parseTargetUrl("example.com/guide")).toBe("https://example.com/guide");
  });

  it("refuses empty input, other schemes and hosts without a dot", () => {
    expect(parseTargetUrl("")).toBeNull();
    expect(parseTargetUrl("ftp://example.com")).toBeNull();
    expect(parseTargetUrl("javascript:alert(1)")).toBeNull();
    expect(parseTargetUrl("localhost")).toBeNull();
  });
});

describe("returnPath", () => {
  it("sends a connect flow back to onboarding with its notice until onboarded", () => {
    expect(returnPath({ onboardedAt: null }, "/app?connected=1")).toBe("/onboarding?connected=1");
    expect(returnPath({ onboardedAt: null }, "/app/settings/stripe")).toBe("/onboarding");
    expect(returnPath({ onboardedAt: new Date() }, "/app?connected=1")).toBe("/app?connected=1");
  });
});
