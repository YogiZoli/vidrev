import { getDb } from "@/db/client";
import { currentSession } from "@/server/auth/current";
import { logRefused, recordAction } from "@/server/events";
import { isSameOrigin, redirectTo } from "@/server/http";
import { checkRedirectUri, issueConnectCode, pdtRedirectOrigins, redirectWith } from "@/server/pdt";
import { guarded } from "@/server/route-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Allow or Cancel on /connect/pdt (DECISIONS A-30). Allow sends PDT a one-time
// code (10 minutes); Cancel sends error=denied. Both carry PDT's state back.
async function postHandler(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const form = await request.formData();
  const target = checkRedirectUri(String(form.get("redirect_uri") ?? ""), pdtRedirectOrigins());
  if (!target) {
    logRefused("pdt.connect", "redirect_uri not allowed");
    return redirectTo("/connect/pdt");
  }
  const state = String(form.get("state") ?? "").slice(0, 500);
  const session = await currentSession();
  if (!session) {
    const back = new URLSearchParams({ redirect_uri: target.toString(), state });
    return redirectTo(`/api/connect/pdt/login?${back.toString()}`);
  }
  const who = { userId: session.user.id, accountId: session.account.id };
  const db = getDb();
  if (form.get("decision") !== "allow") {
    await recordAction(db, who, "pdt.connect.cancelled");
    return redirectTo(redirectWith(target, { error: "denied", state }));
  }
  const code = await issueConnectCode(db, { ...who, redirectOrigin: target.origin });
  await recordAction(db, who, "pdt.connect.allowed", { origin: target.origin });
  return redirectTo(redirectWith(target, { code, state }));
}

export const POST = guarded("/api/connect/pdt", postHandler);
