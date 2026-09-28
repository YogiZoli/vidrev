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

export function clientIp(headers: Headers): string {
  return headers.get("cf-connecting-ip") ?? headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

// Every answer is logged: accepted events with their outcome, refusals with
// the reason, so a creator's "my sale did not show up" can be traced.
function refused(kind: string, reason: string, status: number, fields: Record<string, unknown> = {}): Response {
  log("warn", "inbound hook refused", { kind, reason, status, ...fields });
  return json({ error: reason, ...(fields.issues ? { issues: fields.issues } : {}) }, status);
}

export async function handleInbound(request: Request, kind: "optin" | "purchase"): Promise<Response> {
  const ip = clientIp(request.headers);
  // Only failed authorizations count against an address; callers with a
  // good token are limited per account below.
  const blocked = failureLimit.peek(`ip:${ip}`);
  if (blocked > 0) {
    log("warn", "inbound hook refused", { kind, reason: "rate_limited_bad_tokens", status: 429 });
    return json({ error: "rate_limited" }, 429, { "retry-after": String(blocked) });
  }
  const unauthorized = (why: string) => {
    failureLimit.hit(`ip:${ip}`);
    return refused(kind, "unauthorized", 401, { why });
  };

  const token = readToken(request);
  const raw = await readRaw(request);
  if (!raw.ok) return refused(kind, raw.error, raw.status);
  const db = getDb();
  const account = token ? await accountForToken(db, token) : null;
  if (!account || !token) return unauthorized(token ? "unknown token" : "no token");
  const signature = request.headers.get("x-signature");
  if (signature && !verifySignature(raw.raw, signature, token)) return unauthorized("bad signature");

  const accountWait = accountLimit.hit(account.accountId);
  if (accountWait > 0) {
    log("warn", "inbound hook refused", { kind, reason: "rate_limited", status: 429, accountId: account.accountId });
    return json({ error: "rate_limited" }, 429, { "retry-after": String(accountWait) });
  }
  // Suspended accounts are not measured (SPEC section 8); a 2xx keeps the
  // sending tool from retrying forever.
  if (!account.active) {
    log("info", "inbound hook ignored", { kind, accountId: account.accountId, reason: "account_suspended" });
    return json({ ok: true, ignored: "account_suspended" }, 202);
  }

  const body = parseBody(raw.raw, request.headers.get("content-type"));
  if (!body.ok) return refused(kind, body.error, body.status, { accountId: account.accountId });
  const now = new Date();
  try {
    const emit = (input: Parameters<typeof emitFromWeb>[1]) => emitFromWeb(db, input);
    if (kind === "optin") {
      const parsed = parseOptIn(body.fields, now);
      if (!parsed.ok) return refused(kind, "invalid_payload", 400, { accountId: account.accountId, issues: parsed.errors });
      const result = await recordOptIn(db, account.accountId, parsed.value, { source: "webhook", emit });
      log("info", "inbound opt-in recorded", { accountId: account.accountId, created: result.created, attributed: result.attributed, tracked: Boolean(parsed.value.tid) });
      return json({ ok: true, created: result.created, attributed: result.attributed });
    }
    const parsed = parsePurchase(body.fields, now);
    if (!parsed.ok) return refused(kind, "invalid_payload", 400, { accountId: account.accountId, issues: parsed.errors });
    const result = await recordPurchase(db, account.accountId, parsed.value, { source: "webhook", raw: body.fields, emit });
    log("info", "inbound purchase recorded", { accountId: account.accountId, created: result.created, refundUpdated: result.refundUpdated, externalId: parsed.value.externalId });
    return json({ ok: true, created: result.created, refund_updated: result.refundUpdated });
  } catch (error) {
    log("error", "inbound hook failed", { ...errorFields(error), kind, accountId: account.accountId });
    return json({ error: "internal_error" }, 500);
  }
}
