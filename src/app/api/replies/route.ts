import { getDb } from "@/db/client";
import { enqueue } from "@/jobs/enqueue";
import { QUEUES } from "@/jobs/queues";
import { TEMPLATE_PROBLEM_TEXT, type TemplateProblem } from "@/lib/templates";
import { type ApprovalError, approveReply, dismissReply, markSentManually, sendJitterSeconds, switchMatch } from "@/server/approval";
import { currentSession } from "@/server/auth/current";
import { isSameOrigin } from "@/server/http";

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

  switch (input.action) {
    case "approve": {
      const result = await approveReply(db, { accountId, replyId, body: String(input.body ?? "") });
      if (!result.ok) return Response.json({ error: errorText(result.error) }, { status: 409 });
      await enqueue(QUEUES.replySend, { replyId }, { singletonKey: replyId, startAfter: sendJitterSeconds() });
      return Response.json({ ok: true });
    }
    case "dismiss":
      return (await dismissReply(db, accountId, replyId)) ? Response.json({ ok: true }) : Response.json({ error: errorText("not_found") }, { status: 409 });
    case "manual":
      return (await markSentManually(db, accountId, replyId, input.body))
        ? Response.json({ ok: true })
        : Response.json({ error: errorText("not_found") }, { status: 409 });
    case "switch":
      return (await switchMatch(db, accountId, replyId, String(input.campaignId ?? "")))
        ? Response.json({ ok: true })
        : Response.json({ error: errorText("not_found") }, { status: 409 });
    default:
      return Response.json({ error: "Unknown action" }, { status: 400 });
  }
}
