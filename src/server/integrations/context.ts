import { and, eq, gte, lte } from "drizzle-orm";
import { campaigns, clicks, replies } from "@/db/schema";
import type { TagTouch } from "@/lib/tags";
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

// The window of the click history. Clicks are first-party data (our own
// tracked links), so nothing read from the YouTube API reaches a CRM (A-12).
export const HISTORY_DAYS = 30;

// The person's tracked-link clicks in the 30 days before an opt-in or a
// purchase: each keyword, its temperature and the video, once. Bots excluded.
export async function clickHistory(db: DbOrTx, accountId: string, contactId: string | null, at: Date): Promise<TagTouch[]> {
  if (!contactId) return [];
  const rows = await db
    .select({ keyword: clicks.keyword, videoId: clicks.youtubeVideoId, replyIntent: replies.intent, campaignIntent: campaigns.intent })
    .from(clicks)
    .leftJoin(replies, eq(replies.id, clicks.replyId))
    .leftJoin(campaigns, eq(campaigns.id, clicks.campaignId))
    .where(
      and(
        eq(clicks.accountId, accountId),
        eq(clicks.contactId, contactId),
        eq(clicks.isBot, false),
        gte(clicks.createdAt, new Date(at.getTime() - HISTORY_DAYS * 86_400_000)),
        lte(clicks.createdAt, at),
      ),
    );
  const seen = new Set<string>();
  const touches: TagTouch[] = [];
  for (const row of rows) {
    const key = `${row.keyword.toLowerCase()}|${row.videoId ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    touches.push({ keyword: row.keyword, intent: row.replyIntent ?? row.campaignIntent ?? null, videoId: row.videoId });
  }
  return touches;
}
