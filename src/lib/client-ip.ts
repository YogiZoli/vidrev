// The visitor's address behind Cloudflare and Railway: Cloudflare's header
// first, then the first X-Forwarded-For hop, then X-Real-IP. Null when none.
export function clientIp(headers: Headers): string | null {
  return headers.get("cf-connecting-ip") ?? headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? headers.get("x-real-ip") ?? null;
}
