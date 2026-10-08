import { cookies } from "next/headers";
import { getDb } from "@/db/client";
import { clientIp } from "@/lib/client-ip";
import { errorFields, log } from "@/lib/log";
import { RateLimiter } from "@/lib/ratelimit";
import { requireEnv } from "@/lib/env";
import { sessionCookie } from "@/server/auth/current";
import { takeReturnPath } from "@/server/auth/return-to";
import { signInWithPassword } from "@/server/auth/sign-in";
import { createSession } from "@/server/auth/tokens";
import { isSameOrigin, redirectTo } from "@/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// 10 tries per 15 minutes per address and per email: enough for typos, too few to guess.
const byIp = new RateLimiter(10, 15 * 60 * 1000);
const byEmail = new RateLimiter(10, 15 * 60 * 1000);

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return redirectTo("/login?error=invalid");
  if (byIp.hit(clientIp(request.headers) ?? "unknown") || byEmail.hit(email)) return redirectTo("/login?error=busy");

  try {
    const db = getDb();
    const userId = await signInWithPassword(db, email, password);
    if (!userId) return redirectTo("/login?error=invalid");
    const session = await createSession(db, userId);
    const store = await cookies();
    store.set(sessionCookie(session.token));
    log("info", "user signed in", { userId, method: "password" });
    return redirectTo(takeReturnPath(store, requireEnv("AUTH_SECRET")));
  } catch (error) {
    log("error", "password sign-in failed", errorFields(error));
    return redirectTo("/login?error=server");
  }
}
