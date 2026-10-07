import { cookies } from "next/headers";
import { getDb } from "@/db/client";
import { clientIp } from "@/lib/client-ip";
import { isValidEmail } from "@/lib/email";
import { errorFields, log } from "@/lib/log";
import { passwordProblem } from "@/lib/password";
import { RateLimiter } from "@/lib/ratelimit";
import { sessionCookie } from "@/server/auth/current";
import { signUpWithPassword } from "@/server/auth/sign-in";
import { createSession } from "@/server/auth/tokens";
import { isSameOrigin, redirectTo } from "@/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// 5 sign-ups an hour per address.
const limiter = new RateLimiter(5, 60 * 60 * 1000);

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim();
  const name = String(form.get("name") ?? "").trim().slice(0, 120) || null;
  const password = String(form.get("password") ?? "");
  if (!isValidEmail(email)) return redirectTo("/signup?error=email");
  if (passwordProblem(password)) return redirectTo("/signup?error=password");
  if (limiter.hit(clientIp(request.headers) ?? "unknown")) return redirectTo("/signup?error=busy");

  try {
    const db = getDb();
    const result = await signUpWithPassword(db, { email, name, password });
    if (!result.ok) return redirectTo("/signup?error=exists");
    const session = await createSession(db, result.userId);
    (await cookies()).set(sessionCookie(session.token));
    log("info", "account signed up", { userId: result.userId, method: "password" });
    return redirectTo("/app");
  } catch (error) {
    log("error", "sign-up failed", errorFields(error));
    return redirectTo("/signup?error=server");
  }
}
