import { cookies } from "next/headers";
import { randomToken } from "@/lib/crypto";
import { requireEnv } from "@/lib/env";
import { signValue } from "@/lib/signed";
import { currentSession } from "@/server/auth/current";
import { ghlClient, ghlConfigured, GHL_COOKIE, GHL_COOKIE_PATH, GHL_COOKIE_TTL_MS, ghlScopes } from "@/server/ghl/config";
import { buildInstallUrl } from "@/server/ghl/oauth";
import { clientIsSecure, redirectTo } from "@/server/http";
import { returnPath } from "@/server/onboarding";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PAGE = "/app/settings/gohighlevel";

// "Connect GoHighLevel": HighLevel asks the creator to pick the sub-account
// (location) and approve the scopes, then calls back.
export async function GET(): Promise<Response> {
  const session = await currentSession();
  if (!session) return redirectTo("/login");
  if (!ghlConfigured()) return redirectTo(returnPath(session.account, `${PAGE}?error=${encodeURIComponent("Connecting GoHighLevel is not available yet.")}`));
  if (session.account.status === "suspended") return redirectTo(returnPath(session.account, `${PAGE}?error=${encodeURIComponent("Your account is suspended.")}`));

  const state = randomToken(24);
  (await cookies()).set({
    name: GHL_COOKIE,
    value: signValue({ state, userId: session.user.id }, requireEnv("AUTH_SECRET"), new Date(Date.now() + GHL_COOKIE_TTL_MS)),
    httpOnly: true,
    secure: clientIsSecure(),
    sameSite: "lax",
    path: GHL_COOKIE_PATH,
    maxAge: GHL_COOKIE_TTL_MS / 1000,
  });
  return redirectTo(buildInstallUrl(ghlClient(), ghlScopes(), state), 302);
}
