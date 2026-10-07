import { getDb } from "@/db/client";
import { isValidEmail } from "@/lib/email";
import { currentSession, isAdminEmail } from "@/server/auth/current";
import { type AdminAction, runAdminAction } from "@/server/admin";
import { isSameOrigin, redirectTo } from "@/server/http";
import { log } from "@/lib/log";
import { sendLoginLink } from "@/server/notify";
import { enqueue } from "@/jobs/enqueue";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function parseAction(form: FormData): AdminAction | null {
  const field = (name: string) => String(form.get(name) ?? "").trim();
  switch (field("kind")) {
    case "grant":
      return isValidEmail(field("email")) && field("planCode") ? { kind: "grant", email: field("email"), planCode: field("planCode") } : null;
    case "set_plan":
      return field("accountId") && field("planCode") ? { kind: "set_plan", accountId: field("accountId"), planCode: field("planCode") } : null;
    case "suspend":
      return field("accountId") ? { kind: "suspend", accountId: field("accountId") } : null;
    case "unsuspend":
      return field("accountId") ? { kind: "unsuspend", accountId: field("accountId") } : null;
    case "block_links":
    case "unblock_links":
      return field("accountId") ? { kind: "block_links", accountId: field("accountId"), blocked: field("kind") === "block_links" } : null;
    case "create_coupon": {
      const kind = field("couponKind") === "partner" ? "partner" : "trial";
      const num = (name: string) => (field(name) ? Number.parseInt(field(name), 10) : null);
      const expires = field("expiresAt") ? new Date(`${field("expiresAt")}T23:59:59Z`) : null;
      if (!field("code") || (expires && Number.isNaN(expires.getTime()))) return null;
      return { kind: "create_coupon", code: field("code"), couponKind: kind, days: kind === "trial" ? (num("days") ?? 14) : null, maxUses: num("maxUses"), expiresAt: expires, note: field("note") || null };
    }
    default:
      return null;
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const session = await currentSession();
  if (!session || !isAdminEmail(session.user.email)) {
    log("warn", "owner admin action refused", { reason: session ? "not an admin" : "signed out", userId: session?.user.id });
    return new Response("Forbidden", { status: 403 });
  }

  const form = await request.formData();
  // Restore of a contact the Beast Mode sweep deleted (A-27): the worker makes it again.
  if (form.get("kind") === "restore_prospect") {
    const backupId = String(form.get("backupId") ?? "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(backupId)) return redirectTo(`/admin?msg=${encodeURIComponent("Invalid request.")}`);
    await enqueue("ghl.prospect_restore", { backupId });
    log("info", "owner admin action", { kind: "restore_prospect", backupId, userId: session.user.id });
    return redirectTo(`/admin?msg=${encodeURIComponent("Restore queued. The contact is made again within a minute.")}`);
  }
  const action = parseAction(form);
  if (!action) return redirectTo(`/admin?msg=${encodeURIComponent("Invalid request.")}`);

  const db = getDb();
  const result = await runAdminAction(db, session.user.email, action);
  log(result.ok ? "info" : "warn", "owner admin action", { kind: action.kind, ok: result.ok, message: result.message, userId: session.user.id });
  if (result.ok && result.loginLink) await sendLoginLink(db, result.loginLink);
  return redirectTo(`/admin?msg=${encodeURIComponent(result.message)}`);
}
