import { cookies } from "next/headers";
import { getDb } from "@/db/client";
import { enqueue } from "@/jobs/enqueue";
import { QUEUES } from "@/jobs/queues";
import { requireEnv } from "@/lib/env";
import { errorFields, log } from "@/lib/log";
import { verifySignedValue } from "@/lib/signed";
import { currentSession } from "@/server/auth/current";
import { connectGhl } from "@/server/ghl/connect";
import { ghlClient, ghlConfigured, GHL_COOKIE, GHL_COOKIE_PATH } from "@/server/ghl/config";
import { exchangeGhlCode } from "@/server/ghl/oauth";
import { redirectTo } from "@/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface GhlCookie extends Record<string, unknown> {
  state: string;
  userId: string;
}

const PAGE = "/app/integrations";
const fail = (message: string) => redirectTo(`${PAGE}?error=${encodeURIComponent(message)}`);

const CONNECT_ERRORS = {
  not_location: "Choose one sub-account (location) when connecting, not the whole agency.",
  location_taken: "This GoHighLevel account is already connected to another account here.",
  already_connected: "Another GoHighLevel account is already connected. Disconnect it first.",
} as const;

// HighLevel redirects here after the creator picked a location. The code has to
// be exchanged now (it is short-lived); the field setup and first sync run in the worker.
export async function GET(request: Request): Promise<Response> {
  const session = await currentSession();
  if (!session) return redirectTo("/login");
  if (!ghlConfigured()) return fail("Connecting GoHighLevel is not available yet.");

  const store = await cookies();
  const saved = verifySignedValue<GhlCookie>(store.get(GHL_COOKIE)?.value, requireEnv("AUTH_SECRET"));
  store.delete({ name: GHL_COOKIE, path: GHL_COOKIE_PATH });

  const params = new URL(request.url).searchParams;
  if (params.get("error")) return fail("The GoHighLevel permission was not granted.");
  const code = params.get("code");
  if (!saved || !code || params.get("state") !== saved.state || saved.userId !== session.user.id) {
    return fail("The connection request expired. Try again.");
  }
  if (session.account.status !== "active") return fail("Your account is suspended.");

  try {
    const tokens = await exchangeGhlCode(ghlClient(), code);
    const result = await connectGhl(getDb(), requireEnv("ENCRYPTION_KEY"), session.account.id, tokens);
    if (!result.ok) return fail(CONNECT_ERRORS[result.error]);
    await enqueue(QUEUES.ghlSetup, { integrationId: result.id }, { singletonKey: result.id });
    log("info", "ghl connect started", { accountId: session.account.id, integrationId: result.id });
    return redirectTo(`${PAGE}?ghl_connected=1`);
  } catch (error) {
    log("error", "ghl oauth callback failed", errorFields(error));
    return fail("Connecting GoHighLevel failed. Try again.");
  }
}
