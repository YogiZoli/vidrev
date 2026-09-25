import { describe, expect, it } from "vitest";
import { normalizeCurrency, toMinorUnits } from "./money";

describe("minor units", () => {
  it("converts decimals to integer cents", () => {
    expect(toMinorUnits("97", "USD")).toBe(9700);
    expect(toMinorUnits("97.5", "USD")).toBe(9750);
    expect(toMinorUnits(97.05, "usd")).toBe(9705);
    expect(toMinorUnits("0.29", "USD")).toBe(29);
    expect(toMinorUnits("19.99", "EUR")).toBe(1999);
  });

  it("respects zero and three decimal currencies", () => {
    expect(toMinorUnits("1500", "JPY")).toBe(1500);
    expect(toMinorUnits("1500.00", "VND")).toBe(1500);
    expect(toMinorUnits("1500.5", "JPY")).toBeNull();
    expect(toMinorUnits("1.234", "KWD")).toBe(1234);
  });

  it("refuses anything that is not a plain non-negative decimal", () => {
    for (const bad of ["1,234.50", "$97", "97 USD", "-5", "", "abc", "1e3", "12.345", NaN, undefined, null, {}]) {
      expect(toMinorUnits(bad, "USD")).toBeNull();
    }
  });

  it("accepts trailing zeros beyond the currency precision", () => {
    expect(toMinorUnits("12.500", "USD")).toBe(1250);
  });

  it("normalizes currency codes", () => {
    expect(normalizeCurrency(" usd ")).toBe("USD");
    expect(normalizeCurrency("US")).toBeNull();
    expect(normalizeCurrency(5)).toBeNull();
  });
});
