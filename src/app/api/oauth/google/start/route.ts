import { cookies } from "next/headers";
import { getDb } from "@/db/client";
import { randomToken } from "@/lib/crypto";
import { requireEnv } from "@/lib/env";
import { signValue } from "@/lib/signed";
import { currentSession } from "@/server/auth/current";
import { countLiveChannels } from "@/server/channels";
import { appGoogleClient, googleConfigured, OAUTH_COOKIE, OAUTH_COOKIE_PATH, OAUTH_COOKIE_TTL_MS } from "@/server/google/config";
import { buildAuthUrl, createPkcePair } from "@/server/google/oauth";
import { clientIsSecure, redirectTo } from "@/server/http";
import { returnPath } from "@/server/onboarding";
import { guarded } from "@/server/route-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function getHandler(): Promise<Response> {
  const session = await currentSession();
  if (!session) return redirectTo("/login");
  if (!googleConfigured()) return redirectTo(returnPath(session.account, "/app/settings/youtube?error=google_not_configured"));
  if (session.account.status !== "active") return redirectTo(returnPath(session.account, "/app/settings/youtube?error=account_suspended"));
  if ((await countLiveChannels(getDb(), session.account.id)) >= session.plan.channelLimit) {
    return redirectTo(returnPath(session.account, "/app/settings/youtube?error=channel_limit"));
  }

  const state = randomToken(24);
  const pkce = createPkcePair();
  const expiresAt = new Date(Date.now() + OAUTH_COOKIE_TTL_MS);
  (await cookies()).set({
    name: OAUTH_COOKIE,
    value: signValue({ state, verifier: pkce.verifier, userId: session.user.id }, requireEnv("AUTH_SECRET"), expiresAt),
    httpOnly: true,
    secure: clientIsSecure(),
    sameSite: "lax",
    path: OAUTH_COOKIE_PATH,
    maxAge: OAUTH_COOKIE_TTL_MS / 1000,
  });
  return redirectTo(buildAuthUrl(appGoogleClient(), state, pkce.challenge), 302);
}

export const GET = guarded("/api/oauth/google/start", getHandler);
