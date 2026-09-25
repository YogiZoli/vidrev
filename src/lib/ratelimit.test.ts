import { describe, expect, it } from "vitest";
import { RateLimiter } from "./ratelimit";

describe("rate limiter", () => {
  it("allows up to the limit, then says how long to wait", () => {
    const limiter = new RateLimiter(3, 60_000);
    expect([1, 2, 3].map(() => limiter.hit("a", 1000))).toEqual([0, 0, 0]);
    expect(limiter.hit("a", 11_000)).toBe(50);
  });

  it("peek does not count", () => {
    const limiter = new RateLimiter(2, 1000);
    expect(limiter.peek("a", 0)).toBe(0);
    limiter.hit("a", 0);
    limiter.hit("a", 0);
    expect(limiter.peek("a", 100)).toBe(1);
    expect(limiter.peek("a", 1000)).toBe(0);
  });

  it("counts keys separately and resets after the window", () => {
    const limiter = new RateLimiter(1, 1000);
    expect(limiter.hit("a", 0)).toBe(0);
    expect(limiter.hit("b", 0)).toBe(0);
    expect(limiter.hit("a", 500)).toBeGreaterThan(0);
    expect(limiter.hit("a", 1000)).toBe(0);
  });
});
