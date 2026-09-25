import { and, eq, inArray, isNotNull, isNull, lte, type SQL } from "drizzle-orm";
import type { Db } from "@/db/client";
import { accounts, campaigns, clicks, links, purchases, replies, subscribers } from "@/db/schema";
import { attributePurchases, type AttributionResult, type PurchaseFact, type Touch } from "@/lib/attribution";
import type { DbOrTx } from "./accounts";

// Loads an account's purchases and touches, runs the attribution rules
// (src/lib/attribution.ts) and writes back only the rows that changed. The
// whole account is recomputed each time: a late opt-in (a CRM syncing after
// the purchase webhook) can move a purchase to a closer touch, and the rules
// stay one deterministic function of the stored first-party data.

// Marks an account's reports stale; the engine tick queues the refresh. Cheap
// on the hot path (clicks): nothing is written when it is already marked.
export async function markReportDirty(db: DbOrTx, accountId: string, now = new Date()): Promise<void> {
  await db.update(accounts).set({ reportDirtyAt: now }).where(and(eq(accounts.id, accountId), isNull(accounts.reportDirtyAt)));
}

// Clears the flag set before `startedAt`; data arriving during a run marks it again.
export async function claimReportDirty(db: Db, accountId: string, startedAt: Date): Promise<void> {
  await db.update(accounts).set({ reportDirtyAt: null }).where(and(eq(accounts.id, accountId), lte(accounts.reportDirtyAt, startedAt)));
}

export async function dirtyAccounts(db: Db, limit = 100): Promise<string[]> {
  const rows = await db.select({ id: accounts.id }).from(accounts).where(isNotNull(accounts.reportDirtyAt)).orderBy(accounts.reportDirtyAt).limit(limit);
  return rows.map((row) => row.id);
}

// Hourly: every account gets a fresh look, so periods roll over ("this
// month") and nothing depends on a missed flag.
export async function markAllReportsDirty(db: Db, now = new Date()): Promise<void> {
  await db.update(accounts).set({ reportDirtyAt: now }).where(isNull(accounts.reportDirtyAt));
}

const CHUNK = 500;

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
  return out;
}

async function loadTouches(db: Db, accountId: string, tids: string[], emails: string[], contactIds: string[]) {
  const clickByTid = new Map<string, Touch>();
  for (const part of chunks(tids)) {
    const rows = await db
      .select({ click: clicks, intent: links.intent })
      .from(clicks)
      .innerJoin(links, eq(links.id, clicks.linkId))
      .where(and(eq(clicks.accountId, accountId), eq(clicks.isBot, false), inArray(clicks.tid, part)));
    for (const { click, intent } of rows) {
      clickByTid.set(click.tid, {
        at: click.createdAt,
        clickId: click.id,
        replyId: click.replyId,
        campaignId: click.campaignId,
        videoId: click.youtubeVideoId,
        keyword: click.keyword,
        intent: intent ?? null,
        subscriberId: null,
      });
    }
  }

  // Opt-ins of the buyers' emails and of their Contacts (an opt-in under a
  // second email of the same person still counts, DECISIONS section 13).
  const optInsByEmail = new Map<string, Touch[]>();
  const optInsByContact = new Map<string, Touch[]>();
  const seen = new Set<string>();
  const load = (match: SQL) =>
    db
      .select({ s: subscribers, replyIntent: replies.intent, campaignIntent: campaigns.intent })
      .from(subscribers)
      .leftJoin(replies, eq(replies.id, subscribers.replyId))
      .leftJoin(campaigns, eq(campaigns.id, subscribers.campaignId))
      // Only opt-ins traced to a comment are touches.
      .where(and(eq(subscribers.accountId, accountId), isNotNull(subscribers.keyword), match));
  const add = ({ s, replyIntent, campaignIntent }: Awaited<ReturnType<typeof load>>[number]) => {
    if (seen.has(s.id)) return;
    seen.add(s.id);
    const touch: Touch = {
      at: s.occurredAt,
      clickId: s.clickId,
      replyId: s.replyId,
      campaignId: s.campaignId,
      videoId: s.youtubeVideoId,
      keyword: s.keyword!,
      intent: replyIntent ?? campaignIntent ?? null,
      subscriberId: s.id,
    };
    optInsByEmail.set(s.emailNorm, [...(optInsByEmail.get(s.emailNorm) ?? []), touch]);
    if (s.contactId) optInsByContact.set(s.contactId, [...(optInsByContact.get(s.contactId) ?? []), touch]);
  };
  for (const part of chunks(emails)) for (const row of await load(inArray(subscribers.emailNorm, part))) add(row);
  for (const part of chunks(contactIds)) for (const row of await load(inArray(subscribers.contactId, part))) add(row);
  return { clickByTid, optInsByEmail, optInsByContact };
}

type PurchaseRow = typeof purchases.$inferSelect;

function columnsOf(result: AttributionResult) {
  const t = result.touch;
  return {
    canonicalPurchaseId: result.canonicalId,
    netCents: result.netCents,
    attributionMethod: result.method,
    attributedSubscriberId: t?.subscriberId ?? null,
    attributedClickId: t?.clickId ?? null,
    attributedReplyId: t?.replyId ?? null,
    attributedCampaignId: t?.campaignId ?? null,
    attributedVideoId: t?.videoId ?? null,
    attributedKeyword: t?.keyword ?? null,
    attributedIntent: (t?.intent ?? null) as PurchaseRow["attributedIntent"],
    attributedTouchAt: t?.at ?? null,
  };
}

function unchanged(row: PurchaseRow, next: ReturnType<typeof columnsOf>): boolean {
  return (Object.keys(next) as (keyof typeof next)[]).every((key) => {
    const a = row[key];
    const b = next[key];
    return a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b;
  });
}

export async function runAttribution(db: Db, accountId: string, now = new Date()): Promise<{ purchases: number; changed: number }> {
  const rows = await db.select().from(purchases).where(eq(purchases.accountId, accountId));
  if (rows.length === 0) return { purchases: 0, changed: 0 };
  const tids = [...new Set(rows.map((r) => r.tid).filter((v): v is string => Boolean(v)))];
  const emails = [...new Set(rows.map((r) => r.emailNorm).filter((v): v is string => Boolean(v)))];
  const contactIds = [...new Set(rows.map((r) => r.contactId).filter((v): v is string => Boolean(v)))];
  const lookup = await loadTouches(db, accountId, tids, emails, contactIds);

  const facts: PurchaseFact[] = rows.map((r) => ({
    id: r.id,
    source: r.source,
    kind: r.kind,
    emailNorm: r.emailNorm,
    contactId: r.contactId,
    tid: r.tid,
    amountCents: r.amountCents,
    currency: r.currency,
    refundedCents: r.refundedCents,
    subscriptionRef: r.subscriptionRef,
    occurredAt: r.occurredAt,
    createdAt: r.createdAt,
  }));
  const results = attributePurchases(facts, lookup);

  let changed = 0;
  await db.transaction(async (tx) => {
    for (const row of rows) {
      const next = columnsOf(results.get(row.id)!);
      if (row.attributionComputedAt && unchanged(row, next)) continue;
      changed += 1;
      await tx
        .update(purchases)
        .set({ ...next, attributionComputedAt: now })
        .where(eq(purchases.id, row.id));
    }
  });
  return { purchases: rows.length, changed };
}
