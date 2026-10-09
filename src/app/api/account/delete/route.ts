import { cookies } from "next/headers";
import { getDb } from "@/db/client";
import { enqueue } from "@/jobs/enqueue";
import { QUEUES } from "@/jobs/queues";
import { log } from "@/lib/log";
import { requestAccountDeletion } from "@/server/account-deletion";
import { currentSession, SESSION_COOKIE } from "@/server/auth/current";
import { deleteSession } from "@/server/auth/tokens";
import { isSameOrigin, redirectTo } from "@/server/http";
import { guarded } from "@/server/route-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PAGE = "/app/settings";

// Settings > Account > Delete my account. The account stops at once; the
// worker revokes the grants and deletes everything (server/account-deletion.ts).
async function postHandler(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const session = await currentSession();
  if (!session) return redirectTo("/login");
  const form = await request.formData();
  const typed = String(form.get("confirm_email") ?? "").trim().toLowerCase();
  if (typed !== session.user.email.trim().toLowerCase()) {
    return redirectTo(`${PAGE}?delete_error=${encodeURIComponent("Type your account email exactly to confirm.")}`);
  }
  const db = getDb();
  await requestAccountDeletion(db, { accountId: session.account.id, userId: session.user.id });
  await enqueue(QUEUES.accountDelete, { accountId: session.account.id }, { singletonKey: session.account.id });
  log("info", "account deletion requested", { accountId: session.account.id });

  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await deleteSession(db, token);
  store.delete(SESSION_COOKIE);
  return redirectTo("/data-deletion?requested=1");
}

export const POST = guarded("/api/account/delete", postHandler);
