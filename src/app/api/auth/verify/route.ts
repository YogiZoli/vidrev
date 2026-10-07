import { cookies } from "next/headers";
import { getDb } from "@/db/client";
import { sessionCookie } from "@/server/auth/current";
import { consumeMagicLink, createSession } from "@/server/auth/tokens";
import { isSameOrigin, redirectTo } from "@/server/http";
import { log } from "@/lib/log";
import { guarded } from "@/server/route-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The emailed link opens /auth/verify, which posts here. Consuming the token
// only on POST keeps mail scanners that prefetch links from burning it.
async function postHandler(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const token = String((await request.formData()).get("token") ?? "");
  if (!token) return redirectTo("/login?error=expired");

  const db = getDb();
  const userId = await consumeMagicLink(db, token);
  if (!userId) {
    log("warn", "sign-in link refused", { reason: "expired or used" });
    return redirectTo("/login?error=expired");
  }

  const session = await createSession(db, userId);
  (await cookies()).set(sessionCookie(session.token));
  log("info", "user signed in", { userId });
  return redirectTo("/app");
}

export const POST = guarded("/api/auth/verify", postHandler);
