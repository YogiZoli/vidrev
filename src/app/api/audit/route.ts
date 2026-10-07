import { getDb } from "@/db/client";
import { enqueue } from "@/jobs/enqueue";
import { QUEUES } from "@/jobs/queues";
import { parseChannelInput } from "@/lib/audit/handle";
import { env } from "@/lib/env";
import { errorFields, log } from "@/lib/log";
import { RateLimiter } from "@/lib/ratelimit";
import { verifyTurnstile } from "@/server/audit/report";
import { createAudit } from "@/server/audit/service";
import { isSameOrigin, redirectTo } from "@/server/http";
import { clientIp } from "@/lib/client-ip";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Public entry of Audit my channel (DECISIONS P9-01, P9-11): no sign-in. The
// request only creates a row and queues the worker; YouTube is never called
// here. 5 audits an hour per address.
const startLimit = new RateLimiter(5, 3_600_000);

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return redirectTo("/where-i-lose-money-on-youtube?error=origin");
  const ip = (clientIp(request.headers) ?? "unknown");
  if (startLimit.hit(`ip:${ip}`) > 0) return redirectTo("/where-i-lose-money-on-youtube?error=rate");

  const form = await request.formData().catch(() => null);
  const input = String(form?.get("channel") ?? "").trim();
  const { TURNSTILE_SITE_KEY, TURNSTILE_SECRET_KEY } = env();
  if (TURNSTILE_SITE_KEY && TURNSTILE_SECRET_KEY) {
    const token = String(form?.get("cf-turnstile-response") ?? "") || null;
    if (!(await verifyTurnstile(TURNSTILE_SECRET_KEY, token, ip))) return redirectTo("/where-i-lose-money-on-youtube?error=human");
  }
  const parsed = parseChannelInput(input);
  if (!parsed.ok) return redirectTo(`/where-i-lose-money-on-youtube?error=input&msg=${encodeURIComponent(parsed.error)}`);

  try {
    const { audit, cached } = await createAudit(getDb(), parsed.ref, input);
    if (!cached) await enqueue(QUEUES.auditRun, { auditId: audit.id });
    return redirectTo(`/where-i-lose-money-on-youtube/${audit.id}`);
  } catch (error) {
    log("error", "audit start failed", errorFields(error));
    return redirectTo("/where-i-lose-money-on-youtube?error=server");
  }
}
