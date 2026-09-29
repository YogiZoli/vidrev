import { getDb } from "@/db/client";
import { enqueue } from "@/jobs/enqueue";
import { QUEUES } from "@/jobs/queues";
import { TEMPLATE_PROBLEM_TEXT, type TemplateProblem } from "@/lib/templates";
import { type ApprovalError, approveReply, dismissReply, markSentManually, restoreReply, sendJitterSeconds, switchMatch } from "@/server/approval";
import { currentSession } from "@/server/auth/current";
import { isSameOrigin } from "@/server/http";
import { logRefused, recordAction } from "@/server/events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ERROR_TEXT: Record<Exclude<ApprovalError, TemplateProblem>, string> = {
  not_found: "This reply is no longer waiting for approval.",
  account_suspended: "Your account is suspended.",
  channel_not_connected: "Your channel is not connected. Connect it again to send replies.",
  monthly_cap: "Your plan's monthly reply limit is reached. You can still post by hand.",
  daily_cap: "Today's safety limit of replies is reached. You can still post by hand.",
};

function errorText(error: ApprovalError): string {
  return error in ERROR_TEXT ? ERROR_TEXT[error as keyof typeof ERROR_TEXT] : TEMPLATE_PROBLEM_TEXT[error as TemplateProblem];
}

// JSON endpoint for the approval queue (optimistic UI). One reply per call:
// there is no batch approval (Q-12).
export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return Response.json({ error: "Forbidden" }, { status: 403 });
  const session = await currentSession();
  if (!session) return Response.json({ error: "Sign in again." }, { status: 401 });
  const input = (await request.json().catch(() => ({}))) as { action?: string; replyId?: string; body?: string; campaignId?: string };
  const replyId = String(input.replyId ?? "");
  const accountId = session.account.id;
  const db = getDb();

  const who = { userId: session.user.id, accountId };
  const action = String(input.action ?? "");
  const refused = (reason: ApprovalError | "unknown_action", status = 409) => {
    logRefused(`reply.${action}`, reason, { accountId, replyId });
    return Response.json({ error: reason === "unknown_action" ? "Unknown action" : errorText(reason) }, { status });
  };
  const ok = async (details: Record<string, unknown> = {}) => {
    await recordAction(db, who, `reply.${action}`, { replyId, ...details });
    return Response.json({ ok: true });
  };

  switch (action) {
    case "approve": {
      const result = await approveReply(db, { accountId, replyId, body: String(input.body ?? "") });
      if (!result.ok) return refused(result.error);
      await enqueue(QUEUES.replySend, { replyId }, { singletonKey: replyId, startAfter: sendJitterSeconds() });
      return ok();
    }
    case "dismiss":
      return (await dismissReply(db, accountId, replyId)) ? ok() : refused("not_found");
    case "restore":
      return (await restoreReply(db, accountId, replyId)) ? ok() : refused("not_found");
    case "manual":
      return (await markSentManually(db, accountId, replyId, input.body)) ? ok() : refused("not_found");
    case "switch":
      return (await switchMatch(db, accountId, replyId, String(input.campaignId ?? ""))) ? ok({ campaignId: input.campaignId }) : refused("not_found");
    default:
      return refused("unknown_action", 400);
  }
}
