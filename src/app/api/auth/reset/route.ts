import { cookies } from "next/headers";
import { getDb } from "@/db/client";
import { log } from "@/lib/log";
import { passwordProblem } from "@/lib/password";
import { sessionCookie } from "@/server/auth/current";
import { setPassword } from "@/server/auth/sign-in";
import { consumeMagicLink, createSession } from "@/server/auth/tokens";
import { isSameOrigin, redirectTo } from "@/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const form = await request.formData();
  const token = String(form.get("token") ?? "");
  const password = String(form.get("password") ?? "");
  if (passwordProblem(password)) return redirectTo(`/auth/reset?token=${encodeURIComponent(token)}&error=password`);

  const db = getDb();
  const userId = token ? await consumeMagicLink(db, token) : null;
  if (!userId) return redirectTo("/forgot?error=expired");
  await setPassword(db, userId, password);
  const session = await createSession(db, userId);
  (await cookies()).set(sessionCookie(session.token));
  log("info", "password set", { userId });
  return redirectTo("/app");
}
