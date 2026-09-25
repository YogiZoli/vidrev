import { describe, expect, it } from "vitest";
import { pacificDate, pacificMonth } from "./time";

describe("Pacific quota day", () => {
  it("rolls over at midnight Pacific, not UTC", () => {
    // 06:59 UTC on Sept 26 is 23:59 PDT on Sept 25.
    expect(pacificDate(new Date("2026-09-26T06:59:00Z"))).toBe("2026-09-25");
    expect(pacificDate(new Date("2026-09-26T07:00:00Z"))).toBe("2026-09-26");
  });

  it("follows standard time in winter (UTC-8)", () => {
    expect(pacificDate(new Date("2026-12-01T07:59:00Z"))).toBe("2026-11-30");
    expect(pacificDate(new Date("2026-12-01T08:00:00Z"))).toBe("2026-12-01");
  });

  it("gives the Pacific month", () => {
    expect(pacificMonth(new Date("2026-10-01T06:00:00Z"))).toBe("2026-09");
    expect(pacificMonth(new Date("2026-10-01T08:00:00Z"))).toBe("2026-10");
  });
});
