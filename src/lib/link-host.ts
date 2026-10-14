// Values are trimmed like env() does (a pasted value once carried a BOM,
// which made the fallback host null and the card API answer 503).
// Which link host a request is for. Link traffic reaches the web service
// through Cloudflare, which rewrites Host to the Railway domain and passes the
// original host in X-Original-Host (SPEC-REVIEW R-03). The fallback host may
// also arrive directly. Null means the request is for the app itself.
export function fallbackHost(): string | null {
  try {
    return process.env.LINK_FALLBACK_BASE_URL?.trim() ? new URL(process.env.LINK_FALLBACK_BASE_URL.trim()).hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

export function appHost(): string | null {
  try {
    return process.env.APP_BASE_URL?.trim() ? new URL(process.env.APP_BASE_URL.trim()).hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

// The marketing host: BRAND_BASE_URL without "www.", e.g. vidrev.app. Null
// when unset, unparsable, or the same host as the app.
export function brandHost(app = appHost()): string | null {
  try {
    const raw = process.env.BRAND_BASE_URL?.trim();
    if (!raw) return null;
    const host = new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
    return host === app ? null : host;
  } catch {
    return null;
  }
}

// Which marketing host a request is for (the apex or its www), or null. The
// marketing host shows the landing only; the app itself lives on APP_BASE_URL.
export function brandHostOf(headers: Headers, brand = brandHost()): string | null {
  if (!brand) return null;
  const raw = headers.get("x-original-host") ?? headers.get("host");
  const host = raw?.split(":")[0]?.trim().toLowerCase();
  return host === brand || host === `www.${brand}` ? host : null;
}

export function linkHostOf(headers: Headers, fallback = fallbackHost(), app = appHost()): string | null {
  const original = headers.get("x-original-host")?.split(":")[0]?.trim().toLowerCase();
  if (original) return original === app ? null : original;
  const host = headers.get("host")?.split(":")[0]?.trim().toLowerCase();
  return host && host === fallback ? host : null;
}

