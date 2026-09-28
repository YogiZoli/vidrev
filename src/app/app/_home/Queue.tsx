import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { campaigns } from "@/db/schema";
import { env } from "@/lib/env";
import { fallbackHost } from "@/lib/link-host";
import { repliesLeftToday } from "@/lib/quota";
import { nextPacificMidnight, pacificDate } from "@/lib/time";
import { requireSession } from "@/server/auth/current";
import { queueView } from "@/server/campaigns";
import { ensureReplyLink } from "@/server/links";
import { dayUsage } from "@/server/quota";
import { replyUsage } from "@/server/replies";
import { commentUrl } from "@/server/youtube/api";
import { Keyword } from "@/components/ui/badge";
import { Meta, SectionTitle } from "@/components/ui/page";
import { Table, TableWrap, Td } from "@/components/ui/table";
import { type CardData, PendingCards, WaitingCards } from "./QueueCards";
import { REPLY_REASONS } from "@/lib/status-text";




function formatUtc(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

// The approval queue, the daily action on Home.
export async function ApprovalQueue() {
  const { account, plan } = await requireSession();
  const db = getDb();
  const now = new Date();
  const rows = await queueView(db, account.id);
  const destinations = new Map(
    (await db.select({ id: campaigns.id, url: campaigns.destinationUrl }).from(campaigns).where(eq(campaigns.accountId, account.id))).map((c) => [c.id, c.url]),
  );
  // Tracked links for replies that can still be posted, so "Copy reply"
  // carries the same link the API would post (Phase 5).
  const trackedLinks = new Map<string, string>();
  for (const row of rows) {
    if (!["pending_approval", "approved", "queued", "failed", "skipped"].includes(row.reply.status)) continue;
    const link = await ensureReplyLink(db, row.reply.id, { fallbackHost: fallbackHost() }, now);
    if (link) trackedLinks.set(row.reply.id, link.url);
  }
  const usage = await replyUsage(db, account.id, now);
  const reset = nextPacificMidnight(now);

  // Estimated send time for replies waiting for the reset: the queue drains
  // first after midnight Pacific, in approval order.
  const queuedOrder = rows
    .filter((row) => row.reply.status === "queued")
    .map((row) => row.reply.id)
    .reverse();
  const cards: CardData[] = rows
    .map((row) => {
      const position = queuedOrder.indexOf(row.reply.id) + 1;
      const queued = position > 0;
      return {
        id: row.reply.id,
        status: row.reply.status,
        statusReason: row.reply.statusReason,
        keyword: row.reply.keyword,
        intent: row.reply.intent,
        otherMatches: row.reply.otherMatches,
        body: row.reply.body,
        link: trackedLinks.get(row.reply.id) ?? ((row.reply.campaignId && destinations.get(row.reply.campaignId)) || "(link)"),
        commentText: row.comment?.text ?? null,
        videoTitle: row.videoTitle,
        commentUrl: row.comment ? commentUrl(row.reply.youtubeVideoId, row.comment.youtubeCommentId) : null,
        repliedBefore: row.repliedBefore,
        eta: queued ? `waiting for YouTube's daily limit to reset, about ${formatUtc(reset)} (#${position} in line)` : null,
      };
    });

  const pending = cards.filter((c) => c.status === "pending_approval").reverse();
  const waiting = cards.filter((c) => ["approved", "queued", "sending"].includes(c.status));
  const done = cards.filter((c) => ["sent", "sent_manually", "failed", "skipped"].includes(c.status)).slice(0, 20);
  const quotaLeft = repliesLeftToday(await dayUsage(db, pacificDate(now)), env().QUOTA_DAILY_LIMIT);

  return (
    <section className="grid gap-4" aria-labelledby="queue-title">
      <div className="grid gap-1">
        <SectionTitle id="queue-title">Approval queue</SectionTitle>
        <Meta className="text-[15px]">
          Every reply waits for your approval. Replies this month: {usage.thisMonth}
          {plan.monthlyReplyCap !== null ? ` of ${plan.monthlyReplyCap}` : ""}; today: {usage.today}
          {plan.dailyReplyCap !== null ? ` of ${plan.dailyReplyCap}` : ""}.
        </Meta>
      </div>
      <PendingCards cards={pending} usage={{ today: usage.today, dailyCap: plan.dailyReplyCap }} />

      {waiting.length ? (
        <section className="grid gap-3">
          <SectionTitle>Waiting to send</SectionTitle>
          <Meta className="text-[15px]">
            YouTube limits how many replies all apps can post through its API each day; this is YouTube&apos;s limit, not ours.
            {quotaLeft === 0 ? " Today's limit is used up." : ""} Approved replies are sent as soon as it allows, first after the daily reset
            at midnight Pacific time. You can also post any of them yourself now.
          </Meta>
          <WaitingCards cards={waiting} />
        </section>
      ) : null}

      {done.length ? (
        <section className="grid gap-3">
          <SectionTitle>Recent</SectionTitle>
          <TableWrap>
            <Table>
              <tbody>
                {done.map((card) => (
                  <tr key={card.id}>
                    <Td>
                      <Keyword>{card.keyword}</Keyword>
                    </Td>
                    <Td>
                      {card.status.replace("_", " ")}
                      {card.statusReason ? ` (${REPLY_REASONS[card.statusReason] ?? card.statusReason})` : ""}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </section>
      ) : null}
    </section>
  );
}
