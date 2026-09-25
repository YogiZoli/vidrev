// Fixed-window counter per key, in memory. The web service is a single
// instance for now; if it scales out, each instance limits on its own, which
// only makes the limit slightly looser, never wrong. Public endpoints also
// need an upper bound on how much a leaked token can flood.
export class RateLimiter {
  private windows = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  // Returns 0 when allowed, else the seconds until the window resets.
  hit(key: string, now = Date.now()): number {
    const current = this.windows.get(key);
    if (!current || now - current.start >= this.windowMs) {
      this.windows.set(key, { start: now, count: 1 });
      this.sweep(now);
      return 0;
    }
    current.count += 1;
    return current.count > this.limit ? Math.max(1, Math.ceil((current.start + this.windowMs - now) / 1000)) : 0;
  }

  // Seconds to wait when the key is already over its limit; does not count.
  peek(key: string, now = Date.now()): number {
    const current = this.windows.get(key);
    if (!current || now - current.start >= this.windowMs || current.count < this.limit) return 0;
    return Math.max(1, Math.ceil((current.start + this.windowMs - now) / 1000));
  }

  private sweep(now: number): void {
    if (this.windows.size < 5000) return;
    for (const [key, w] of this.windows) if (now - w.start >= this.windowMs) this.windows.delete(key);
  }
}
