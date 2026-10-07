import { cookies } from "next/headers";
import { randomToken } from "@/lib/crypto";
import { requireEnv } from "@/lib/env";
import { signValue } from "@/lib/signed";
import { googleConfigured, OAUTH_COOKIE_TTL_MS, SIGNIN_COOKIE, SIGNIN_COOKIE_PATH, signInGoogleClient } from "@/server/google/config";
import { buildSignInUrl, createPkcePair } from "@/server/google/oauth";
import { clientIsSecure, redirectTo } from "@/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// "Continue with Google" on /login and /signup.
export async function GET(request: Request): Promise<Response> {
  const from = new URL(request.url).searchParams.get("from") === "signup" ? "/signup" : "/login";
  if (!googleConfigured()) return redirectTo(`${from}?error=google`);
  const state = randomToken(24);
  const pkce = createPkcePair();
  const expiresAt = new Date(Date.now() + OAUTH_COOKIE_TTL_MS);
  (await cookies()).set({
    name: SIGNIN_COOKIE,
    value: signValue({ state, verifier: pkce.verifier, from }, requireEnv("AUTH_SECRET"), expiresAt),
    httpOnly: true,
    secure: clientIsSecure(),
    sameSite: "lax",
    path: SIGNIN_COOKIE_PATH,
    maxAge: OAUTH_COOKIE_TTL_MS / 1000,
  });
  return redirectTo(buildSignInUrl(signInGoogleClient(), state, pkce.challenge), 302);
}
