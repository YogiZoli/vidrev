import { cookies } from "next/headers";
import { getDb } from "@/db/client";
import { clientIp } from "@/lib/client-ip";
import { env } from "@/lib/env";
import { decryptGhlSso } from "@/lib/ghl-sso";
import { errorFields, log } from "@/lib/log";
import { RateLimiter } from "@/lib/ratelimit";
import { SESSION_COOKIE } from "@/server/auth/current";
import { createSession, SESSION_TTL_MS } from "@/server/auth/tokens";
import { signInFromGhl } from "@/server/ghl/sso";
import { isSameOrigin } from "@/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const limiter = new RateLimiter(30, 60 * 1000);

// The /embed page posts the encrypted user GoHighLevel handed it. The session
// cookie set here is SameSite=None and Partitioned: it is sent only inside
// GoHighLevel's frame, never to another site that might frame vidrev.
export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const key = env().GHL_SSO_KEY;
  if (!key) return Response.json({ ok: false, reason: "not_configured" }, { status: 503 });
  if (limiter.hit(clientIp(request.headers) ?? "unknown")) return Response.json({ ok: false, reason: "busy" }, { status: 429 });

  const body = (await request.json().catch(() => ({}))) as { payload?: unknown };
  let sso;
  try {
    sso = decryptGhlSso(typeof body.payload === "string" ? body.payload : "", key);
  } catch {
    log("warn", "ghl sso payload refused");
    return Response.json({ ok: false, reason: "invalid" }, { status: 400 });
  }

  try {
    const db = getDb();
    const result = await signInFromGhl(db, sso);
    if (!result.ok) {
      log("info", "ghl sso without a connected account", { reason: result.reason, locationId: sso.activeLocation });
      return Response.json({ ok: false, reason: result.reason });
    }
    const session = await createSession(db, result.userId);
    (await cookies()).set({
      name: SESSION_COOKIE,
      value: session.token,
      httpOnly: true,
      secure: true,
      sameSite: "none",
      partitioned: true,
      path: "/",
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
    });
    log("info", "user signed in", { userId: result.userId, method: "ghl_sso", locationId: sso.activeLocation });
    return Response.json({ ok: true, next: "/app" });
  } catch (error) {
    log("error", "ghl sso failed", errorFields(error));
    return Response.json({ ok: false, reason: "server" }, { status: 500 });
  }
}
