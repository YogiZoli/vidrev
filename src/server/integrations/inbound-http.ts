import { getDb } from "@/db/client";
import { parseBody, parseOptIn, parsePurchase, readRaw } from "@/lib/inbound";
import { errorFields, log } from "@/lib/log";
import { RateLimiter } from "@/lib/ratelimit";
import { verifySignature } from "@/lib/webhooks";
import { emitFromWeb } from "./emit-web";
import { accountForToken, recordOptIn, recordPurchase } from "./inbound";

// Universal inbound hooks (SPEC sections 9 and 10, SPEC-REVIEW R-05):
// POST /api/hooks/optin and /api/hooks/purchase with a per-account token.
// The token goes in `Authorization: Bearer`, in `X-Hook-Token`, or in a
// `?token=` query parameter for tools that cannot set headers. When
// `X-Signature` is present it must be the HMAC-SHA256 of the raw body made with
// the token.

// 120 requests a minute per account; 30 bad tokens a minute per address.
const accountLimit = new RateLimiter(120, 60_000);
const failureLimit = new RateLimiter(30, 60_000);

function json(body: Record<string, unknown>, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });
}

export function readToken(request: Request): string | null {
  const bearer = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization")?.trim() ?? "")?.[1];
  return bearer ?? request.headers.get("x-hook-token")?.trim() ?? new URL(request.url).searchParams.get("token")?.trim() ?? null;
}

function clientIp(headers: Headers): string {
  return headers.get("cf-connecting-ip") ?? headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

export async function handleInbound(request: Request, kind: "optin" | "purchase"): Promise<Response> {
  const ip = clientIp(request.headers);
  // Only failed authorizations count against an address; callers with a
  // good token are limited per account below.
  const blocked = failureLimit.peek(`ip:${ip}`);
  if (blocked > 0) return json({ error: "rate_limited" }, 429, { "retry-after": String(blocked) });
  const unauthorized = () => {
    failureLimit.hit(`ip:${ip}`);
    return json({ error: "unauthorized" }, 401);
  };

  const token = readToken(request);
  const raw = await readRaw(request);
  if (!raw.ok) return json({ error: raw.error }, raw.status);
  const db = getDb();
  const account = token ? await accountForToken(db, token) : null;
  if (!account || !token) return unauthorized();
  const signature = request.headers.get("x-signature");
  if (signature && !verifySignature(raw.raw, signature, token)) return unauthorized();

  const accountWait = accountLimit.hit(account.accountId);
  if (accountWait > 0) return json({ error: "rate_limited" }, 429, { "retry-after": String(accountWait) });
  // Suspended accounts are not measured (SPEC section 8); a 2xx keeps the
  // sending tool from retrying forever.
  if (!account.active) return json({ ok: true, ignored: "account_suspended" }, 202);

  const body = parseBody(raw.raw, request.headers.get("content-type"));
  if (!body.ok) return json({ error: body.error }, body.status);
  const now = new Date();
  try {
    const emit = (input: Parameters<typeof emitFromWeb>[1]) => emitFromWeb(db, input);
    if (kind === "optin") {
      const parsed = parseOptIn(body.fields, now);
      if (!parsed.ok) return json({ error: "invalid_payload", issues: parsed.errors }, 400);
      const result = await recordOptIn(db, account.accountId, parsed.value, { source: "webhook", emit });
      return json({ ok: true, created: result.created, attributed: result.attributed });
    }
    const parsed = parsePurchase(body.fields, now);
    if (!parsed.ok) return json({ error: "invalid_payload", issues: parsed.errors }, 400);
    const result = await recordPurchase(db, account.accountId, parsed.value, { source: "webhook", raw: body.fields, emit });
    return json({ ok: true, created: result.created, refund_updated: result.refundUpdated });
  } catch (error) {
    log("error", "inbound hook failed", { ...errorFields(error), kind, accountId: account.accountId });
    return json({ error: "internal_error" }, 500);
  }
}
