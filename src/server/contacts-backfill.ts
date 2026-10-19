import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { accounts, clicks, comments, purchases, replies, subscribers } from "@/db/schema";
import { attachClickToContact, contactForTouch, resolveContact } from "./contacts";
import { claimDirectTids } from "./links";

// Builds Contacts for rows written before Contacts existed (DECISIONS section
// 13.10). Only rows without a contact_id are touched, and the resolver never
// duplicates, so the run is idempotent and can be repeated at any time. The
// worker runs it at start and hourly; with nothing to do it costs three
// cheap queries per account.

export interface BackfillResult {
  replies: number;
  clicks: number;
  subscribers: number;
  purchases: number;
}

export async function backfillContacts(db: Db, accountId?: string): Promise<BackfillResult> {
  const result: BackfillResult = { replies: 0, clicks: 0, subscribers: 0, purchases: 0 };
  const pending = await db
    .selectDistinct({ id: accounts.id })
    .from(accounts)
    .where(
      accountId
        ? eq(accounts.id, accountId)
        : sql`exists (select 1 from replies r where r.account_id = ${accounts.id} and r.contact_id is null)
           or exists (select 1 from subscribers s where s.account_id = ${accounts.id} and s.contact_id is null)
           or exists (select 1 from purchases p where p.account_id = ${accounts.id} and p.contact_id is null)`,
    );
  for (const { id } of pending) {
    const one = await backfillAccount(db, id);
    result.replies += one.replies;
    result.clicks += one.clicks;
    result.subscribers += one.subscribers;
    result.purchases += one.purchases;
  }
  return result;
}

async function backfillAccount(db: Db, accountId: string): Promise<BackfillResult> {
  const result: BackfillResult = { replies: 0, clicks: 0, subscribers: 0, purchases: 0 };

  // Replies: the commenter is known while the comment is stored (author id).
  // After the 30 day deletion nothing recognises the person, so each such reply
  // is its own Contact; it is never guessed to be someone else.
  const orphanReplies = await db
    .select({ reply: replies, authorChannelId: comments.authorChannelId, youtubeCommentId: comments.youtubeCommentId })
    .from(replies)
    .leftJoin(comments, eq(comments.id, replies.commentId))
    .where(and(eq(replies.accountId, accountId), isNull(replies.contactId)))
    .orderBy(asc(replies.createdAt));
  for (const row of orphanReplies) {
    const person = await resolveContact(db, {
      accountId,
      keys: { youtubeChannel: row.authorChannelId, commentFallback: row.youtubeCommentId ?? `reply:${row.reply.id}` },
      event: "comment",
      createdVia: "backfill",
      source: "backfill",
      at: row.reply.createdAt,
      channelId: row.youtubeCommentId ? row.reply.channelId : null,
      refCommentId: row.youtubeCommentId,
    });
    await db.update(replies).set({ contactId: person.contactId }).where(eq(replies.id, row.reply.id));
    result.replies += 1;
  }
  // Clicks follow the reply their link was minted for.
  const clicked = await db.execute(sql`
    update clicks c set contact_id = r.contact_id
    from replies r
    where c.account_id = ${accountId} and c.contact_id is null and c.reply_id = r.id and r.contact_id is not null`);
  result.clicks = clicked.rowCount ?? 0;

  const optIns = await db
    .select()
    .from(subscribers)
    .where(and(eq(subscribers.accountId, accountId), isNull(subscribers.contactId)))
    .orderBy(asc(subscribers.occurredAt));
  for (const s of optIns) {
    const person = await resolveContact(db, {
      accountId,
      keys: { email: s.emailNorm, ghlContact: s.ghlContactId },
      anchors: [await contactForTouch(db, accountId, { clickId: s.clickId, replyId: s.replyId })],
      event: "opt_in",
      createdVia: "backfill",
      source: `opt_in:${s.source}`,
      at: s.occurredAt,
      displayName: s.name,
    });
    await db.update(subscribers).set({ contactId: person.contactId }).where(eq(subscribers.id, s.id));
    await attachClickToContact(db, accountId, s.clickId, person.contactId);
    result.subscribers += 1;
  }

  const buys = await db
    .select()
    .from(purchases)
    .where(and(eq(purchases.accountId, accountId), isNull(purchases.contactId)))
    .orderBy(asc(purchases.occurredAt));
  for (const p of buys) {
    let anchor: string | null = null;
    if (p.tid) {
      await claimDirectTids(db, accountId, [p.tid]);
      const [click] = await db
        .select({ id: clicks.id, replyId: clicks.replyId })
        .from(clicks)
        .where(and(eq(clicks.tid, p.tid), eq(clicks.accountId, accountId), eq(clicks.isBot, false)));
      anchor = await contactForTouch(db, accountId, click ? { clickId: click.id, replyId: click.replyId } : null);
    }
    if (!p.emailNorm && !p.ghlContactId && !anchor) continue;
    const person = await resolveContact(db, {
      accountId,
      keys: { email: p.emailNorm, ghlContact: p.ghlContactId },
      anchors: [anchor],
      event: "purchase",
      createdVia: "backfill",
      source: `purchase:${p.source}`,
      at: p.occurredAt,
    });
    await db.update(purchases).set({ contactId: person.contactId }).where(eq(purchases.id, p.id));
    result.purchases += 1;
  }
  return result;
}
