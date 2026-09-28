import { cookies } from "next/headers";
import { getDb } from "@/db/client";
import { enqueue } from "@/jobs/enqueue";
import { QUEUES } from "@/jobs/queues";
import { requireEnv } from "@/lib/env";
import { errorFields, log } from "@/lib/log";
import { signValue, verifySignedValue } from "@/lib/signed";
import { currentSession } from "@/server/auth/current";
import { CONNECT_ERRORS, connectGhl } from "@/server/ghl/connect";
import { GHL_CLAIM_COOKIE, GHL_CLAIM_PAGE, ghlClient, ghlConfigured, GHL_COOKIE, GHL_COOKIE_PATH } from "@/server/ghl/config";
import { INSTALL_TTL_MS, receiveMarketplaceInstall } from "@/server/ghl/install";
import { exchangeGhlCode } from "@/server/ghl/oauth";
import { clientIsSecure, redirectTo } from "@/server/http";
import { returnPath } from "@/server/onboarding";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface GhlCookie extends Record<string, unknown> {
  state: string;
  userId: string;
}

const PAGE = "/app/settings/gohighlevel";
// Back to the GoHighLevel page, or to onboarding while it is not done.
const fail = (message: string, account?: { onboardedAt: Date | null }) => {
  const path = `${PAGE}?error=${encodeURIComponent(message)}`;
  return redirectTo(account ? returnPath(account, path) : path);
};
const failPublic = (reason: string) => redirectTo(`${GHL_CLAIM_PAGE}?error=${reason}`);

// HighLevel redirects here after the creator picked a location. The code has to
// be exchanged now (it is short-lived); the field setup and first sync run in the worker.
//
// Two ways in: our own "Connect GoHighLevel" button (a signed cookie holds the
// state and the user), and the Marketplace listing's Install button (no cookie,
// the installer may not be signed in: DECISIONS P10-01).
export async function GET(request: Request): Promise<Response> {
  const session = await currentSession();
  const store = await cookies();
  const saved = verifySignedValue<GhlCookie>(store.get(GHL_COOKIE)?.value, requireEnv("AUTH_SECRET"));
  store.delete({ name: GHL_COOKIE, path: GHL_COOKIE_PATH });
  const params = new URL(request.url).searchParams;
  const code = params.get("code");

  if (!saved) {
    if (!code && !params.get("error")) return session ? fail("The connection request expired. Try again.", session?.account) : failPublic("expired");
    return marketplaceInstall(session, code, params.get("error"));
  }

  if (!session) return redirectTo("/login");
  if (!ghlConfigured()) return fail("Connecting GoHighLevel is not available yet.", session?.account);
  if (params.get("error")) return fail("The GoHighLevel permission was not granted.", session?.account);
  if (!code || params.get("state") !== saved.state || saved.userId !== session.user.id) {
    return fail("The connection request expired. Try again.", session?.account);
  }
  if (session.account.status !== "active") return fail("Your account is suspended.", session?.account);

  try {
    const tokens = await exchangeGhlCode(ghlClient(), code);
    const result = await connectGhl(getDb(), requireEnv("ENCRYPTION_KEY"), session.account.id, tokens);
    if (!result.ok) return fail(CONNECT_ERRORS[result.error], session?.account);
    await enqueue(QUEUES.ghlSetup, { integrationId: result.id }, { singletonKey: result.id });
    log("info", "ghl connect started", { accountId: session.account.id, integrationId: result.id });
    return redirectTo(returnPath(session.account, `${PAGE}?ghl_connected=1`));
  } catch (error) {
    log("error", "ghl oauth callback failed", errorFields(error));
    return fail("Connecting GoHighLevel failed. Try again.", session?.account);
  }
}

async function marketplaceInstall(session: Awaited<ReturnType<typeof currentSession>>, code: string | null, denied: string | null): Promise<Response> {
  if (!ghlConfigured()) return failPublic("unavailable");
  if (denied || !code) return failPublic("denied");
  try {
    const db = getDb();
    const key = requireEnv("ENCRYPTION_KEY");
    const tokens = await exchangeGhlCode(ghlClient(), code);

    // Signed in already: connect straight away, exactly as the button would.
    if (session?.account.status === "active") {
      const result = await connectGhl(db, key, session.account.id, tokens);
      if (!result.ok) return fail(CONNECT_ERRORS[result.error], session?.account);
      await enqueue(QUEUES.ghlSetup, { integrationId: result.id }, { singletonKey: result.id });
      log("info", "ghl marketplace install connected", { accountId: session.account.id, integrationId: result.id });
      return redirectTo(returnPath(session.account, `${PAGE}?ghl_connected=1`));
    }

    const install = await receiveMarketplaceInstall(db, key, tokens);
    if (install.kind === "error") return failPublic(install.error);
    if (install.kind === "reconnected") {
      await enqueue(QUEUES.ghlSetup, { integrationId: install.integrationId }, { singletonKey: install.integrationId });
      log("info", "ghl marketplace reinstall", { accountId: install.accountId, integrationId: install.integrationId });
      return redirectTo(`${PAGE}?ghl_connected=1`);
    }

    (await cookies()).set({
      name: GHL_CLAIM_COOKIE,
      value: signValue({ token: install.claimToken }, requireEnv("AUTH_SECRET"), new Date(Date.now() + INSTALL_TTL_MS)),
      httpOnly: true,
      secure: clientIsSecure(),
      sameSite: "lax",
      // Site wide: the dashboard shows "finish connecting" after the sign-in.
      path: "/",
      maxAge: INSTALL_TTL_MS / 1000,
    });
    log("info", "ghl marketplace install waiting for a claim");
    return redirectTo(GHL_CLAIM_PAGE);
  } catch (error) {
    log("error", "ghl marketplace install failed", errorFields(error));
    return failPublic("failed");
  }
}
