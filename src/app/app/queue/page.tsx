import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { campaigns } from "@/db/schema";
import { env } from "@/lib/env";
import { repliesLeftToday } from "@/lib/quota";
import { nextPacificMidnight, pacificDate } from "@/lib/time";
import { requireSession } from "@/server/auth/current";
import { queueView } from "@/server/campaigns";
import { dayUsage } from "@/server/quota";
import { replyUsage } from "@/server/replies";
import { commentUrl } from "@/server/youtube/api";
import { styles } from "../../ui";
import { type CardData, PendingCards, WaitingCards } from "./QueueCards";

export const dynamic = "force-dynamic";

const REASONS: Record<string, string> = {
  monthly_cap: "monthly plan limit reached",
  daily_quota: "YouTube's daily limit",
  comment_gone: "the comment was deleted",
  channel_revoked: "channel access was revoked",
  channel_not_connected: "channel not connected",
  commentsDisabled: "comments are turned off on this video",
  forbidden: "YouTube refused the reply",
};

function formatUtc(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export default async function QueuePage() {
  const { account, plan } = await requireSession();
  const db = getDb();
  const now = new Date();
  const rows = await queueView(db, account.id);
  const links = new Map(
    (await db.select({ id: campaigns.id, url: campaigns.destinationUrl }).from(campaigns).where(eq(campaigns.accountId, account.id))).map((c) => [c.id, c.url]),
  );
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
        link: (row.reply.campaignId && links.get(row.reply.campaignId)) || "(link)",
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
    <main style={{ ...styles.main, padding: "24px 16px" }}>
      <p>
        <a href="/app">Back</a> · <a href="/app/campaigns">Keywords and replies</a>
      </p>
      <h1 style={{ fontSize: 24 }}>Approval queue</h1>
      <p style={styles.muted}>
        Every reply waits for your approval. Replies this month: {usage.thisMonth}
        {plan.monthlyReplyCap !== null ? ` of ${plan.monthlyReplyCap}` : ""}; today: {usage.today}
        {plan.dailyReplyCap !== null ? ` of ${plan.dailyReplyCap}` : ""}.
      </p>
      <PendingCards cards={pending} />

      {waiting.length ? (
        <>
          <h2 style={{ fontSize: 18 }}>Waiting to send</h2>
          <p style={styles.muted}>
            YouTube limits how many replies all apps can post through its API each day; this is YouTube&apos;s limit, not ours.
            {quotaLeft === 0 ? " Today's limit is used up." : ""} Approved replies are sent as soon as it allows, first after the daily reset
            at midnight Pacific time. You can also post any of them yourself now.
          </p>
          <WaitingCards cards={waiting} />
        </>
      ) : null}

      {done.length ? (
        <>
          <h2 style={{ fontSize: 18 }}>Recent</h2>
          <table style={styles.table}>
            <tbody>
              {done.map((card) => (
                <tr key={card.id}>
                  <td style={styles.cell}>{card.keyword}</td>
                  <td style={styles.cell}>
                    {card.status.replace("_", " ")}
                    {card.statusReason ? ` (${REASONS[card.statusReason] ?? card.statusReason})` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </main>
  );
}
