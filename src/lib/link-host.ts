// Which link host a request is for. Link traffic reaches the web service
// through Cloudflare, which rewrites Host to the Railway domain and passes the
// original host in X-Original-Host (SPEC-REVIEW R-03). The fallback host may
// also arrive directly. Null means the request is for the app itself.
export function fallbackHost(): string | null {
  try {
    return process.env.LINK_FALLBACK_BASE_URL ? new URL(process.env.LINK_FALLBACK_BASE_URL).hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

export function appHost(): string | null {
  try {
    return process.env.APP_BASE_URL ? new URL(process.env.APP_BASE_URL).hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

export function linkHostOf(headers: Headers, fallback = fallbackHost(), app = appHost()): string | null {
  const original = headers.get("x-original-host")?.split(":")[0]?.trim().toLowerCase();
  if (original) return original === app ? null : original;
  const host = headers.get("host")?.split(":")[0]?.trim().toLowerCase();
  return host && host === fallback ? host : null;
}

