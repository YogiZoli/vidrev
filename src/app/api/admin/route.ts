import { getDb } from "@/db/client";
import { isValidEmail } from "@/lib/email";
import { currentSession, isAdminEmail } from "@/server/auth/current";
import { type AdminAction, runAdminAction } from "@/server/admin";
import { isSameOrigin, redirectTo } from "@/server/http";
import { sendLoginLink } from "@/server/notify";

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
    default:
      return null;
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const session = await currentSession();
  if (!session || !isAdminEmail(session.user.email)) return new Response("Forbidden", { status: 403 });

  const action = parseAction(await request.formData());
  if (!action) return redirectTo(`/admin?msg=${encodeURIComponent("Invalid request.")}`);

  const db = getDb();
  const result = await runAdminAction(db, session.user.email, action);
  if (result.ok && result.loginLink) await sendLoginLink(db, result.loginLink);
  return redirectTo(`/admin?msg=${encodeURIComponent(result.message)}`);
}
