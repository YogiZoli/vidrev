import { cookies } from "next/headers";
import { getDb } from "@/db/client";
import { requireEnv } from "@/lib/env";
import { errorFields, log } from "@/lib/log";
import { verifySignedValue } from "@/lib/signed";
import { sessionCookie } from "@/server/auth/current";
import { takeReturnPath } from "@/server/auth/return-to";
import { signInWithGoogle } from "@/server/auth/sign-in";
import { createSession } from "@/server/auth/tokens";
import { googleConfigured, SIGNIN_COOKIE, SIGNIN_COOKIE_PATH, signInGoogleClient } from "@/server/google/config";
import { exchangeCode, fetchProfile } from "@/server/google/oauth";
import { redirectTo } from "@/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface SignInCookie extends Record<string, unknown> {
  state: string;
  verifier: string;
  from: string;
}

export async function GET(request: Request): Promise<Response> {
  const store = await cookies();
  const saved = verifySignedValue<SignInCookie>(store.get(SIGNIN_COOKIE)?.value, requireEnv("AUTH_SECRET"));
  store.delete({ name: SIGNIN_COOKIE, path: SIGNIN_COOKIE_PATH });
  const back = saved?.from === "/signup" ? "/signup" : "/login";

  const params = new URL(request.url).searchParams;
  const code = params.get("code");
  if (!googleConfigured() || params.get("error") || !saved || !code || params.get("state") !== saved.state) {
    return redirectTo(`${back}?error=google`);
  }

  try {
    const db = getDb();
    const tokens = await exchangeCode(signInGoogleClient(), code, saved.verifier);
    const profile = await fetchProfile(tokens.access_token);
    const result = await signInWithGoogle(db, profile);
    if (!result.ok) return redirectTo(`${back}?error=google_unverified`);
    const session = await createSession(db, result.userId);
    store.set(sessionCookie(session.token));
    log("info", result.created ? "account signed up" : "user signed in", { userId: result.userId, method: "google" });
    return redirectTo(takeReturnPath(store, requireEnv("AUTH_SECRET")));
  } catch (error) {
    log("error", "google sign-in failed", errorFields(error));
    return redirectTo(`${back}?error=google`);
  }
}
