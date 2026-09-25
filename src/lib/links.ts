import { createHash, randomBytes } from "node:crypto";

// Tracked links (SPEC section 8, SPEC-REVIEW R-07, CC-07). Pure helpers; the
// database side lives in src/server/links.ts.

const ALPHABET = "23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";

export function randomId(length: number, bytes: (n: number) => Buffer = randomBytes): string {
  const buf = bytes(length * 2);
  let out = "";
  // Rejection sampling keeps every character equally likely.
  const limit = 256 - (256 % ALPHABET.length);
  for (let i = 0; i < buf.length && out.length < length; i += 1) {
    const byte = buf[i]!;
    if (byte < limit) out += ALPHABET[byte % ALPHABET.length];
  }
  return out.length === length ? out : randomId(length, bytes);
}

// 7 characters: about 1.7e12 slugs, short enough for a YouTube reply.
export const SLUG_LENGTH = 7;
// Click id carried as c2c_tid: 10 characters.
export const TID_LENGTH = 10;

export const newSlug = () => randomId(SLUG_LENGTH);
export const newTid = () => randomId(TID_LENGTH);

export function isSlug(value: string): boolean {
  return new RegExp(`^[${ALPHABET}]{${SLUG_LENGTH}}$`).test(value);
}

export function linkUrl(host: string, slug: string): string {
  return `https://${host}/${slug}`;
}

// The destination with the click id and UTM parameters appended (CC-07
// layer 1 and 2). Existing query parameters are kept; ours win on a clash.
export function destinationWithTid(destination: string, input: { tid: string | null; keyword: string }): string {
  const url = new URL(destination);
  if (input.tid) {
    url.searchParams.set("c2c_tid", input.tid);
    url.searchParams.set("utm_source", "c2c");
    url.searchParams.set("utm_medium", "comment");
    url.searchParams.set("utm_campaign", input.keyword);
    url.searchParams.set("utm_content", input.tid);
  }
  return url.toString();
}

const BOT_PATTERN =
  /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|quora link|whatsapp|telegram|discord|skype|curl|wget|python-requests|httpclient|go-http|headless|lighthouse|monitor|scan|fetch/i;

export type UserAgentClass = "bot" | "mobile" | "tablet" | "desktop" | "unknown";

export function classifyUserAgent(ua: string | null | undefined): UserAgentClass {
  if (!ua) return "unknown";
  if (BOT_PATTERN.test(ua)) return "bot";
  if (/ipad|tablet/i.test(ua)) return "tablet";
  if (/mobi|android|iphone/i.test(ua)) return "mobile";
  if (/mozilla|opera/i.test(ua)) return "desktop";
  return "unknown";
}

// IP hash with a salt that rotates daily (R-20): unique clicks per day can be
// counted, but an IP cannot be followed across days or reversed.
export function hashIp(ip: string | null, secret: string, day: string): string | null {
  if (!ip) return null;
  return createHash("sha256").update(`${secret}:${day}:${ip}`).digest("base64url").slice(0, 22);
}

// Second-level public suffixes that need one more label, so the cookie lands
// on example.co.uk and not on co.uk. Not exhaustive; unknown ones fall back
// to the host itself (the cookie is then host-only, which is still safe).
const TWO_LEVEL_SUFFIXES = new Set([
  "co.uk", "org.uk", "me.uk", "ltd.uk", "plc.uk", "ac.uk", "gov.uk",
  "com.au", "net.au", "org.au", "co.nz", "org.nz", "co.za", "com.br", "com.mx", "com.ar",
  "co.jp", "ne.jp", "or.jp", "co.kr", "co.in", "net.in", "org.in", "com.sg", "com.my", "com.ph",
  "co.id", "co.th", "in.th", "com.vn", "com.kh", "com.hk", "com.tw", "com.cn", "com.tr", "co.il",
]);

// The registrable domain for the first-party cookie (CC-07 layer 3).
export function cookieDomain(host: string): string | null {
  const labels = host.toLowerCase().replace(/\.$/, "").split(".");
  if (labels.length < 2 || labels.every((l) => /^\d+$/.test(l))) return null;
  const lastTwo = labels.slice(-2).join(".");
  if (TWO_LEVEL_SUFFIXES.has(lastTwo)) return labels.length >= 3 ? labels.slice(-3).join(".") : null;
  return lastTwo;
}

export const TID_COOKIE = "c2c_tid";
export const TID_COOKIE_DAYS = 180;

export function tidCookie(tid: string, host: string): string {
  const domain = cookieDomain(host);
  return [
    `${TID_COOKIE}=${tid}`,
    "Path=/",
    `Max-Age=${TID_COOKIE_DAYS * 86_400}`,
    "Secure",
    "SameSite=Lax",
    ...(domain ? [`Domain=${domain}`] : []),
  ].join("; ");
}

// Host names a customer may use for links: a subdomain (at least three
// labels, no apex, R-03), letters, digits and hyphens only.
export function normalizeHostname(input: string): string | null {
  let value = input.trim().toLowerCase();
  if (!value) return null;
  if (/^https?:\/\//.test(value)) {
    try {
      value = new URL(value).hostname;
    } catch {
      return null;
    }
  }
  value = value.replace(/\.$/, "");
  if (value.length > 253) return null;
  const labels = value.split(".");
  if (labels.some((l) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(l))) return null;
  if (!/[a-z]/.test(labels.at(-1)!)) return null;
  return value;
}

export function isApex(hostname: string): boolean {
  const registrable = cookieDomain(hostname);
  return registrable === null || registrable === hostname;
}

// Shared hosting platforms: the creator does not own these domains.
const PLATFORM_DOMAINS = new Set([
  "leadconnectorhq.com", "msgsndr.com", "gohighlevel.com", "systeme.io", "kajabi.com", "mykajabi.com",
  "teachable.com", "thinkific.com", "gumroad.com", "stan.store", "beacons.ai", "linktr.ee", "carrd.co",
  "notion.site", "clickfunnels.com", "myclickfunnels.com", "kit.com", "ck.page", "convertkit.com",
  "mailchimp.com", "list-manage.com", "wixsite.com", "squarespace.com", "webflow.io", "framer.website",
  "substack.com", "podia.com", "lemonsqueezy.com", "thrivecart.com", "google.com", "youtube.com",
]);

// Suggests go.<registrable domain> from the campaign destination (D-38).
export function suggestHostname(destinationUrl: string | null | undefined): string | null {
  if (!destinationUrl) return null;
  try {
    const registrable = cookieDomain(new URL(destinationUrl).hostname);
    return registrable && !PLATFORM_DOMAINS.has(registrable) ? `go.${registrable}` : null;
  } catch {
    return null;
  }
}
