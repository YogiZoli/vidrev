import { getDb } from "@/db/client";
import { enqueue } from "@/jobs/enqueue";
import { QUEUES } from "@/jobs/queues";
import { currentSession } from "@/server/auth/current";
import { markDisconnecting } from "@/server/channels";
import { isSameOrigin, redirectTo } from "@/server/http";
import { logRefused, recordAction } from "@/server/events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The worker revokes the Google grant and deletes the channel's YouTube data
// (DECISIONS Q-17 c: within 7 days; done right away).
export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const session = await currentSession();
  if (!session) return redirectTo("/login");
  const channelId = String((await request.formData()).get("channelId") ?? "");
  if (!channelId || !(await markDisconnecting(getDb(), session.account.id, channelId))) {
    logRefused("channel.disconnect", "channel not found", { accountId: session.account.id, channelId });
    return redirectTo("/app/settings/youtube?error=channel_not_found");
  }
  await enqueue(QUEUES.channelDisconnect, { channelId });
  await recordAction(getDb(), { userId: session.user.id, accountId: session.account.id }, "channel.disconnect", { channelId });
  return redirectTo("/app/settings/youtube?disconnected=1");
}
