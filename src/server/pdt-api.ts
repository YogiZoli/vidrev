import type { Db } from "@/db/client";
import type { SendEmailJob } from "@/jobs/queues";
import { log } from "@/lib/log";
import { maxCardBytes, validateCardBytes } from "@/lib/publishing-card";
import { RateLimiter } from "@/lib/ratelimit";
import { writeAudit } from "./accounts";
import { videoOutcomes } from "./outcomes";
import { authenticatePdt, bearerToken, exchangeConnectCode, type PdtCaller, revokePdtConnection } from "./pdt";
import { publishCard, saveCard } from "./publishing-cards";

// The PDT API (DECISIONS A-30 to A-35): /api/v1/connect/token, /cards,
// /cards/{cardId}/published, /videos/{videoId}/outcomes, /connect/revoke.
// Every error is {"error": "<a sentence a person can act on>"}; 401 for a
// wrong or revoked token. Tokens and codes never reach a log line.

export interface PdtApiDeps {
  db: Db;
  fallbackHost: string | null;
  enqueueEmail: (job: SendEmailJob) => Promise<void>;
  appBaseUrl: string;
  productName: string;
  now?: () => Date;
}

const NO_STORE = { "cache-control": "no-store" };

export function apiError(status: number, error: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}): Response {
  return Response.json({ error, ...extra }, { status, headers: { ...NO_STORE, ...headers } });
}

function ok(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

// Per token: plenty for a publishing tool, a ceiling for a leaked token.
const perToken = new RateLimiter(120, 60_000);
// Code exchange per client address: guessing a 256 bit code is hopeless anyway.
const perAddress = new RateLimiter(20, 15 * 60_000);

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = JSON.parse(await request.text());
    return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function caller(deps: PdtApiDeps, request: Request): Promise<PdtCaller | Response> {
  const found = await authenticatePdt(deps.db, bearerToken(request.headers), deps.now?.());
  if (!found) return apiError(401, "The token is missing, wrong or revoked. Connect vidrev again from Publishing Dream Team.");
  const wait = perToken.hit(found.connectionId);
  if (wait) return apiError(429, `Too many requests. Wait ${wait} seconds and try again.`, {}, { "retry-after": String(wait) });
  return found;
}

function inactive(found: PdtCaller): Response | null {
  if (found.account.status === "active") return null;
  return apiError(403, "This vidrev account is not active, so nothing can be set up. Open vidrev to activate it.");
}

export async function tokenRoute(deps: PdtApiDeps, request: Request, clientAddress: string | null): Promise<Response> {
  if (perAddress.hit(clientAddress ?? "unknown")) return apiError(429, "Too many tries. Wait 15 minutes and connect again.");
  const body = await readJson(request);
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (!code) return apiError(400, 'Send {"code": "..."} with the code from the connect page.');
  const exchanged = await exchangeConnectCode(deps.db, code, deps.now?.());
  if (!exchanged) return apiError(400, "This code is wrong, expired or already used. Connect again from Publishing Dream Team.");
  await writeAudit(deps.db, { actor: "pdt", accountId: exchanged.accountId, action: "pdt.connected" });
  log("info", "pdt connected", { accountId: exchanged.accountId });
  return ok({ token: exchanged.token, accountName: exchanged.accountName });
}

export async function cardsRoute(deps: PdtApiDeps, request: Request): Promise<Response> {
  const found = await caller(deps, request);
  if (found instanceof Response) return found;
  const limit = maxCardBytes();
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > limit) return apiError(413, `The card is too large. The limit is ${Math.floor(limit / 1024)} KB.`);
  const checked = validateCardBytes(await request.text(), limit);
  if (!checked.ok) {
    const tooLarge = checked.errors[0]?.startsWith("The card is too large");
    log("warn", "pdt card refused", { accountId: found.account.id, problems: checked.errors.length });
    return apiError(tooLarge ? 413 : 422, checked.errors.slice(0, 5).join(" "), { errors: checked.errors.slice(0, 50) });
  }
  const blocked = inactive(found);
  if (blocked) return blocked;
  const saved = await saveCard(deps.db, found.account, checked, { fallbackHost: deps.fallbackHost }, deps.now?.());
  if (!saved.ok) return apiError(saved.status, saved.error);
  log("info", saved.created ? "pdt card created" : "pdt card updated", { accountId: found.account.id, cardId: saved.cardId, keywords: saved.links.length });
  return ok({ cardId: saved.cardId, links: saved.links }, saved.created ? 201 : 200);
}

export async function publishedRoute(deps: PdtApiDeps, request: Request, cardId: string): Promise<Response> {
  const found = await caller(deps, request);
  if (found instanceof Response) return found;
  const blocked = inactive(found);
  if (blocked) return blocked;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cardId)) return apiError(404, "No card with this cardId. Send the card first (POST /api/v1/cards).");
  const body = await readJson(request);
  const videoId = typeof body?.videoId === "string" ? body.videoId.trim() : "";
  if (!videoId) return apiError(400, 'Send {"videoId": "..."} with the YouTube video id.');
  const result = await publishCard(deps, found.account, { cardId, videoId }, deps.now?.());
  if (!result.ok) return apiError(result.status, result.error);
  log("info", "pdt card published", { accountId: found.account.id, cardId, videoId, armed: result.armed, alreadyLive: result.alreadyLive, notArmed: result.notArmed.length });
  return ok({ armed: result.armed, alreadyLive: result.alreadyLive, notArmed: result.notArmed });
}

export async function outcomesRoute(deps: PdtApiDeps, request: Request, videoId: string): Promise<Response> {
  const found = await caller(deps, request);
  if (found instanceof Response) return found;
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return apiError(400, "videoId must be the 11 character YouTube video id.");
  return ok(await videoOutcomes(deps.db, found.account, videoId));
}

export async function revokeRoute(deps: PdtApiDeps, request: Request): Promise<Response> {
  const found = await caller(deps, request);
  if (found instanceof Response) return found;
  await revokePdtConnection(deps.db, found.connectionId, deps.now?.());
  await writeAudit(deps.db, { actor: "pdt", accountId: found.account.id, action: "pdt.revoked" });
  log("info", "pdt connection revoked", { accountId: found.account.id });
  return ok({ revoked: true });
}
