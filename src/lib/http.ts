// Every outbound call (YouTube, Google, GoHighLevel, Stripe, AI, Resend, DNS
// over HTTPS) has a time limit: a hung request would otherwise hold its job
// until pg-boss expires it, minutes later and without a clear reason.
export const DEFAULT_TIMEOUT_MS = 20_000;

export class HttpTimeoutError extends Error {
  constructor(
    readonly url: string,
    readonly timeoutMs: number,
  ) {
    super(`No answer from ${new URL(url).host} within ${timeoutMs / 1000}s`);
    this.name = "HttpTimeoutError";
  }
}

type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>;

// A fetch with a default time limit. A caller's own signal wins; a timeout
// becomes an HttpTimeoutError that names the host.
export function timedFetch(timeoutMs = DEFAULT_TIMEOUT_MS, base: FetchImpl = fetch): FetchImpl {
  return async (input, init) => {
    if (init?.signal) return base(input, init);
    try {
      return await base(input, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) throw new HttpTimeoutError(input, timeoutMs);
      throw error;
    }
  };
}
