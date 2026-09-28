import { describe, expect, it } from "vitest";
import { formatMultiple, formatUsd, moneyLeft, ownershipComparison, validMoneyInput } from "./money";

describe("audit money", () => {
  it("multiplies measured signals by the creator's own numbers", () => {
    const left = moneyLeft({ signals: 27, price: 97, buyRate: 10 });
    expect(left.buyers).toBeCloseTo(2.7);
    expect(left.monthly).toBeCloseTo(261.9);
  });
  it("compares 1,000 views of AdSense with the Ownership Method", () => {
    const c = ownershipComparison(97, 10);
    expect(c.monthly).toBe(970);
    expect(formatMultiple(c.multiple)).toBe("38.80");
    expect(formatUsd(c.monthly)).toBe("$970");
  });
  it("requires both inputs", () => {
    expect(validMoneyInput(97, 10)).toBe(true);
    expect(validMoneyInput(0, 10)).toBe(false);
    expect(validMoneyInput(97, 0)).toBe(false);
    expect(validMoneyInput(97, 101)).toBe(false);
    expect(validMoneyInput(Number.NaN, 10)).toBe(false);
  });
});
