import { getDb } from "@/db/client";
import { parseCrmSyncMode } from "@/lib/crm-sync-mode";
import { currentSession } from "@/server/auth/current";
import { setCrmSyncMode } from "@/server/crm-sync-mode";
import { logRefused, recordAction } from "@/server/events";
import { isSameOrigin, redirectTo } from "@/server/http";
import { guarded } from "@/server/route-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// CRM sync mode form (DECISIONS A-25), posted from onboarding and Settings.
async function postHandler(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const session = await currentSession();
  if (!session) return redirectTo("/login");
  const form = await request.formData();
  const page = String(form.get("return") ?? "") === "onboarding" ? "/onboarding" : "/app/settings/gohighlevel";
  const accountId = session.account.id;
  const mode = parseCrmSyncMode(String(form.get("mode") ?? ""));
  if (!mode) {
    logRefused("crm_sync_mode", "unknown mode", { accountId });
    return redirectTo(page);
  }
  // Beast Mode puts commenters who never opted in into the CRM: the warning must be acknowledged.
  if (mode === "beast" && form.get("confirm") !== "1") {
    logRefused("crm_sync_mode", "warning not confirmed", { accountId });
    return redirectTo(`${page}?error=${encodeURIComponent("Tick the box to confirm you understand what Beast Mode does.")}`);
  }
  const db = getDb();
  const result = await setCrmSyncMode(db, accountId, mode);
  if (!result.ok) {
    logRefused("crm_sync_mode", "not on the allowlist", { accountId });
    return redirectTo(`${page}?error=${encodeURIComponent(result.error)}`);
  }
  await recordAction(db, { userId: session.user.id, accountId }, "crm_sync_mode.set", { mode });
  return redirectTo(`${page}?mode_saved=1`);
}

export const POST = guarded("/api/crm-sync-mode", postHandler);
