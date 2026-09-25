import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  clicks,
  contactIdentities,
  contactMerges,
  contacts,
  purchases,
  replies,
  subscribers,
  type ContactCreatedVia,
  type ContactStage,
} from "@/db/schema";
import { earlier, identityKeys, later, maxStage, pickWinner, YOUTUBE_IDENTITY_TTL_MS, type KeyInput } from "@/lib/contacts";
import { markReportDirty } from "./attribution";
import type { Tx } from "./accounts";

// The one place Contacts are created, enriched and merged (DECISIONS section
// 13, Q-23). Every event that carries a person goes through resolveContact:
// keyword comment, click, opt-in, purchase, CRM and Stripe sync. A Contact is
// created only when no existing one is recognised from any key of the event;
// two Contacts found by one event are merged into the older one.

export type ContactEvent = "comment" | "opt_in" | "purchase" | "click" | "sync";

export interface ResolveInput {
  accountId: string;
  keys: KeyInput;
  // Contact ids the event already points to (a tid's click or reply, the
  // Contact of a purchase row being updated). They count as keys.
  anchors?: (string | null | undefined)[];
  event: ContactEvent;
  createdVia: ContactCreatedVia;
  // Where the keys came from, kept on the identity (for example "youtube_comment").
  source: string;
  // When the event happened, by our own observation (13.8).
  at: Date;
  displayName?: string | null;
  // Our channel row, so a disconnect can wipe the YouTube identity.
  channelId?: string | null;
  // The YouTube comment that showed the channel id, for the 30 day refresh.
  refCommentId?: string | null;
}

export interface ResolveResult {
  contactId: string;
  created: boolean;
  merged: number;
}

const STAGE_FOR_EVENT: Record<ContactEvent, ContactStage> = {
  comment: "commenter",
  opt_in: "subscriber",
  purchase: "buyer",
  click: "commenter",
  sync: "commenter",
};

type ContactRow = typeof contacts.$inferSelect;

// Contacts merged away point to the winner; follow the pointers so a stale
// reference still lands on the live Contact.
async function liveContacts(tx: Tx, accountId: string, ids: string[]): Promise<ContactRow[]> {
  const live = new Map<string, ContactRow>();
  let pending = [...new Set(ids)];
  for (let depth = 0; depth < 10 && pending.length > 0; depth += 1) {
    const rows = await tx
      .select()
      .from(contacts)
      .where(and(eq(contacts.accountId, accountId), inArray(contacts.id, pending)));
    pending = [];
    for (const row of rows) {
      if (row.mergedIntoId) pending.push(row.mergedIntoId);
      else live.set(row.id, row);
    }
  }
  return [...live.values()];
}

// Section 13.6. Everything of the loser moves to the winner in the caller's
// transaction; the loser stays as a tombstone and the merge is logged.
async function mergeInto(tx: Tx, accountId: string, winnerBefore: ContactRow, loser: ContactRow, reason: string): Promise<void> {
  // An earlier merge in the same event may have changed the winner.
  const [winner] = await tx.select().from(contacts).where(eq(contacts.id, winnerBefore.id));
  const to = { contactId: winner!.id };
  const moved: Record<string, number> = {};
  moved.identities = (
    await tx
      .update(contactIdentities)
      .set(to)
      .where(and(eq(contactIdentities.accountId, accountId), eq(contactIdentities.contactId, loser.id)))
      .returning({ id: contactIdentities.id })
  ).length;
  moved.replies = (await tx.update(replies).set(to).where(eq(replies.contactId, loser.id)).returning({ id: replies.id })).length;
  moved.clicks = (await tx.update(clicks).set(to).where(eq(clicks.contactId, loser.id)).returning({ id: clicks.id })).length;
  moved.subscribers = (await tx.update(subscribers).set(to).where(eq(subscribers.contactId, loser.id)).returning({ id: subscribers.id })).length;
  moved.purchases = (await tx.update(purchases).set(to).where(eq(purchases.contactId, loser.id)).returning({ id: purchases.id })).length;
  await tx.update(contacts).set({ mergedIntoId: winner!.id }).where(eq(contacts.mergedIntoId, loser.id));
  await tx.update(contacts).set({ mergedIntoId: winner!.id, updatedAt: new Date() }).where(eq(contacts.id, loser.id));
  await tx
    .update(contacts)
    .set({
      stage: maxStage(winner!.stage, loser.stage),
      firstSeenAt: earlier(winner!.firstSeenAt, loser.firstSeenAt)!,
      lastSeenAt: later(winner!.lastSeenAt, loser.lastSeenAt)!,
      firstCommentSeenAt: earlier(winner!.firstCommentSeenAt, loser.firstCommentSeenAt),
      subscribedAt: earlier(winner!.subscribedAt, loser.subscribedAt),
      firstPurchaseAt: earlier(winner!.firstPurchaseAt, loser.firstPurchaseAt),
      displayName: winner!.displayName ?? loser.displayName,
      updatedAt: new Date(),
    })
    .where(eq(contacts.id, winner!.id));
  await tx.insert(contactMerges).values({ accountId, winnerId: winner!.id, loserId: loser.id, reason, moved });
}

export async function resolveContact(db: Db, input: ResolveInput): Promise<ResolveResult> {
  const keys = identityKeys(input.keys);
  const anchors = [...new Set((input.anchors ?? []).filter((id): id is string => Boolean(id)))];
  if (keys.length === 0 && anchors.length === 0) throw new Error("resolveContact needs at least one key");

  const result = await db.transaction(async (tx): Promise<ResolveResult> => {
    // One person is resolved at a time per account (13.7); the unique index on
    // the keys is the second line of defence.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.accountId}::text, 13))`);

    const found =
      keys.length === 0
        ? []
        : await tx
            .select()
            .from(contactIdentities)
            .where(
              and(
                eq(contactIdentities.accountId, input.accountId),
                or(...keys.map((k) => and(eq(contactIdentities.kind, k.kind), eq(contactIdentities.value, k.value)))),
              ),
            );
    const live = await liveContacts(tx, input.accountId, [...found.map((r) => r.contactId), ...anchors]);

    let contactId: string;
    let created = false;
    let merged = 0;
    if (live.length === 0) {
      const email = keys.find((k) => k.kind === "email")?.value ?? null;
      const [row] = await tx
        .insert(contacts)
        .values({
          accountId: input.accountId,
          stage: STAGE_FOR_EVENT[input.event],
          primaryEmailNorm: email,
          displayName: input.displayName ?? null,
          createdVia: input.createdVia,
          firstSeenAt: input.at,
          lastSeenAt: input.at,
        })
        .returning({ id: contacts.id });
      contactId = row!.id;
      created = true;
    } else {
      const { winner, losers } = pickWinner(live);
      contactId = winner.id;
      for (const loser of losers) {
        const via = found.find((r) => r.contactId === loser.id)?.kind ?? "anchor";
        await mergeInto(tx, input.accountId, winner, loser, via);
        merged += 1;
      }
    }

    // The "update with the email" step: every key the Contact does not have yet.
    for (const key of keys) {
      const youtube = key.kind === "youtube_channel";
      // YouTube API data (13.9): the channel id, and a comment id used as a key,
      // are confirmed again or deleted within 30 days.
      const apiData = youtube || (key.kind === "comment" && Boolean(input.channelId));
      const refreshDueAt = apiData ? new Date(input.at.getTime() + YOUTUBE_IDENTITY_TTL_MS) : null;
      const insert = tx.insert(contactIdentities).values({
        accountId: input.accountId,
        contactId,
        kind: key.kind,
        value: key.value,
        source: input.source,
        channelId: apiData ? (input.channelId ?? null) : null,
        refCommentId: youtube ? (input.refCommentId ?? null) : null,
        refreshDueAt,
        firstSeenAt: input.at,
      });
      // A new comment confirms a YouTube identity for another 30 days.
      if (youtube) {
        await insert.onConflictDoUpdate({
          target: [contactIdentities.accountId, contactIdentities.kind, contactIdentities.value],
          set: {
            refreshDueAt: sql`greatest(${contactIdentities.refreshDueAt}, excluded.refresh_due_at)`,
            refCommentId: sql`coalesce(excluded.ref_comment_id, ${contactIdentities.refCommentId})`,
            channelId: sql`coalesce(excluded.channel_id, ${contactIdentities.channelId})`,
          },
        });
      } else {
        await insert.onConflictDoNothing();
      }
    }

    const [current] = await tx.select().from(contacts).where(eq(contacts.id, contactId));
    const [firstEmail] = await tx
      .select({ value: contactIdentities.value })
      .from(contactIdentities)
      .where(and(eq(contactIdentities.contactId, contactId), eq(contactIdentities.kind, "email")))
      .orderBy(asc(contactIdentities.firstSeenAt), asc(contactIdentities.createdAt))
      .limit(1);
    await tx
      .update(contacts)
      .set({
        stage: maxStage(current!.stage, STAGE_FOR_EVENT[input.event]),
        firstSeenAt: earlier(current!.firstSeenAt, input.at)!,
        lastSeenAt: later(current!.lastSeenAt, input.at)!,
        firstCommentSeenAt: input.event === "comment" ? earlier(current!.firstCommentSeenAt, input.at) : current!.firstCommentSeenAt,
        subscribedAt: input.event === "opt_in" ? earlier(current!.subscribedAt, input.at) : current!.subscribedAt,
        firstPurchaseAt: input.event === "purchase" ? earlier(current!.firstPurchaseAt, input.at) : current!.firstPurchaseAt,
        // The earliest email seen is the primary one (M-3); after a merge it is recomputed.
        primaryEmailNorm: merged > 0 || !current!.primaryEmailNorm ? (firstEmail?.value ?? current!.primaryEmailNorm) : current!.primaryEmailNorm,
        displayName: current!.displayName ?? input.displayName ?? null,
        updatedAt: new Date(),
      })
      .where(eq(contacts.id, contactId));
    return { contactId, created, merged };
  });
  // Merges move people between counters, so reports are recomputed.
  if (result.merged > 0) await markReportDirty(db, input.accountId);
  return result;
}

// The Contact a tracking id points to: the click's, else the reply's.
export async function contactForTouch(db: Db, accountId: string, touch: { clickId: string | null; replyId: string | null } | null): Promise<string | null> {
  if (!touch) return null;
  if (touch.clickId) {
    const [click] = await db
      .select({ contactId: clicks.contactId })
      .from(clicks)
      .where(and(eq(clicks.id, touch.clickId), eq(clicks.accountId, accountId)));
    if (click?.contactId) return click.contactId;
  }
  if (touch.replyId) {
    const [reply] = await db
      .select({ contactId: replies.contactId })
      .from(replies)
      .where(and(eq(replies.id, touch.replyId), eq(replies.accountId, accountId)));
    if (reply?.contactId) return reply.contactId;
  }
  return null;
}

// A click that had no person yet (static link) belongs to the Contact whose
// opt-in carried its tracking id.
export async function attachClickToContact(db: Db, accountId: string, clickId: string | null, contactId: string): Promise<void> {
  if (!clickId) return;
  await db
    .update(clicks)
    .set({ contactId })
    .where(and(eq(clicks.id, clickId), eq(clicks.accountId, accountId), sql`${clicks.contactId} is distinct from ${contactId}`));
}
