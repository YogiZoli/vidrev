import { isIP } from "node:net";

// Endpoint URLs come from creators, so the worker must never be pointed at our
// own network: no loopback, private, link-local or metadata addresses. The URL
// is checked when saved and the resolved address again when connecting
// (DNS rebinding), see src/server/integrations/http-post.ts.

function ipv4ToNumbers(ip: string): number[] | null {
  const parts = ip.split(".").map(Number);
  return parts.length === 4 && parts.every((p) => Number.isInteger(p) && p >= 0 && p <= 255) ? parts : null;
}

function isPrivateV4(ip: string): boolean {
  const p = ipv4ToNumbers(ip);
  if (!p) return true;
  const [a, b] = p as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) || // IETF protocol assignments, TEST-NET-1 neighbours
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    (a === 198 && b === 51 && p[2] === 100) ||
    (a === 203 && b === 0 && p[2] === 113) ||
    a >= 224 // multicast, reserved, broadcast
  );
}

function expandV6(ip: string): number[] | null {
  let addr = ip.toLowerCase().split("%")[0]!;
  // An embedded IPv4 tail (::ffff:1.2.3.4) becomes two groups.
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
  if (tail) {
    const v4 = ipv4ToNumbers(tail[1]!);
    if (!v4) return null;
    addr = addr.replace(tail[1]!, `${((v4[0]! << 8) | v4[1]!).toString(16)}:${((v4[2]! << 8) | v4[3]!).toString(16)}`);
  }
  const halves = addr.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - rest.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...rest].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

function isPrivateV6(ip: string): boolean {
  const g = expandV6(ip);
  if (!g) return true;
  if (g.every((x) => x === 0)) return true; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
  // IPv4-mapped (::ffff:a.b.c.d) and NAT64 (64:ff9b::/96): judge the v4 part.
  const embedded = () => `${g[6]! >> 8}.${g[6]! & 255}.${g[7]! >> 8}.${g[7]! & 255}`;
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return isPrivateV4(embedded());
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isPrivateV4(embedded());
  if ((g[0]! & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0]! & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0]! & 0xff00) === 0xff00) return true; // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  return false;
}

export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isPrivateV4(ip);
  if (kind === 6) return isPrivateV6(ip);
  return true;
}

export type UrlCheck = { ok: true; url: URL } | { ok: false; error: string };

const BLOCKED_SUFFIXES = [".local", ".localhost", ".internal", ".intranet", ".lan", ".home", ".corp", ".railway.internal"];

// Endpoint URLs must be https on a public host. `allowHttp` is for tests and
// local development only.
export function checkWebhookUrl(raw: string, options: { allowHttp?: boolean } = {}): UrlCheck {
  const value = raw.trim();
  if (value.length === 0 || value.length > 2048) return { ok: false, error: "Enter the endpoint URL." };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, error: "This is not a valid URL." };
  }
  if (url.protocol !== "https:" && !(options.allowHttp && url.protocol === "http:")) {
    return { ok: false, error: "The endpoint must use https." };
  }
  if (url.username || url.password) return { ok: false, error: "Put credentials in a header or token, not in the URL." };
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const literal = isIP(host) !== 0;
  if (literal ? isPrivateAddress(host) : !host.includes(".") || host === "localhost" || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
    return { ok: false, error: "The endpoint must be a public address." };
  }
  return { ok: true, url };
}
