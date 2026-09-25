import { eq } from "drizzle-orm";
import { campaigns, replies } from "@/db/schema";
import type { EventContext } from "@/lib/webhooks";
import type { DbOrTx } from "../accounts";

// Event context for one reply: campaign, keyword, video and channel. The
// comment itself (text, author) is never part of an event.
export async function replyContext(db: DbOrTx, replyId: string): Promise<(EventContext & { accountId: string }) | null> {
  const [row] = await db
    .select({ reply: replies, campaignName: campaigns.name })
    .from(replies)
    .leftJoin(campaigns, eq(campaigns.id, replies.campaignId))
    .where(eq(replies.id, replyId));
  if (!row) return null;
  const { reply } = row;
  return {
    accountId: reply.accountId,
    channelId: reply.channelId,
    videoId: reply.youtubeVideoId,
    campaignId: reply.campaignId,
    campaign: row.campaignName,
    keyword: reply.keyword,
    intent: reply.intent,
    replyId: reply.id,
  };
}
