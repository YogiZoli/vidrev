import { cookies } from "next/headers";
import { getDb } from "@/db/client";
import { enqueue } from "@/jobs/enqueue";
import { QUEUES } from "@/jobs/queues";
import { requireEnv } from "@/lib/env";
import { errorFields, log } from "@/lib/log";
import { verifySignedValue } from "@/lib/signed";
import { currentSession } from "@/server/auth/current";
import { countLiveChannels, createConnectingChannel } from "@/server/channels";
import { appGoogleClient, googleConfigured, OAUTH_COOKIE, OAUTH_COOKIE_PATH } from "@/server/google/config";
import { exchangeCode, grantedYoutubeScope, revokeToken } from "@/server/google/oauth";
import { redirectTo } from "@/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface OAuthCookie extends Record<string, unknown> {
  state: string;
  verifier: string;
  userId: string;
}

// Google redirects here after consent. The code exchange has to happen now
// (codes are short-lived); resolving the channel itself runs in the worker.
export async function GET(request: Request): Promise<Response> {
  const session = await currentSession();
  if (!session) return redirectTo("/login");
  if (!googleConfigured()) return redirectTo("/app?error=google_not_configured");

  const store = await cookies();
  const saved = verifySignedValue<OAuthCookie>(store.get(OAUTH_COOKIE)?.value, requireEnv("AUTH_SECRET"));
  store.delete({ name: OAUTH_COOKIE, path: OAUTH_COOKIE_PATH });

  const params = new URL(request.url).searchParams;
  if (params.get("error")) return redirectTo("/app?error=google_denied");
  const code = params.get("code");
  if (!saved || !code || params.get("state") !== saved.state || saved.userId !== session.user.id) {
    return redirectTo("/app?error=oauth_state");
  }

  const db = getDb();
  if ((await countLiveChannels(db, session.account.id)) >= session.plan.channelLimit) {
    return redirectTo("/app?error=channel_limit");
  }

  try {
    const tokens = await exchangeCode(appGoogleClient(), code, saved.verifier);
    if (!grantedYoutubeScope(tokens.scope) || !tokens.refresh_token) {
      // Without the YouTube permission or offline access the channel cannot
      // work; hand the grant back instead of storing a useless token.
      await revokeToken(tokens.refresh_token ?? tokens.access_token).catch(() => {});
      return redirectTo(`/app?error=${tokens.refresh_token ? "scope_missing" : "no_refresh_token"}`);
    }
    const channelId = await createConnectingChannel(
      db,
      {
        accountId: session.account.id,
        refreshToken: tokens.refresh_token,
        accessToken: tokens.access_token,
        expiresInSeconds: tokens.expires_in,
        scopes: tokens.scope,
      },
      requireEnv("ENCRYPTION_KEY"),
    );
    await enqueue(QUEUES.channelSync, { channelId });
    log("info", "channel connect started", { accountId: session.account.id, channelId });
    return redirectTo("/app?connected=1");
  } catch (error) {
    log("error", "google oauth callback failed", errorFields(error));
    return redirectTo("/app?error=oauth_failed");
  }
}
