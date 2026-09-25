import { and, desc, eq, gte, lte } from "drizzle-orm";
import type { Db } from "@/db/client";
import { accounts, campaigns, clicks, inboundHookSecrets, purchases, subscribers, type PurchaseSource, type SubscriberSource } from "@/db/schema";
import { decryptSecret, encryptSecret, randomToken, sha256Hex } from "@/lib/crypto";
import type { OptInInput, PurchaseInput } from "@/lib/inbound";
import type { EmitInput } from "./events";

// Recording of opt-ins and purchases from any source (SPEC sections 9, 10):
// the universal inbound hooks, GHL and later Stripe all end up here.

export type Emit = (input: EmitInput) => Promise<void>;

export const HOOK_TOKEN_PREFIX = "c2c_hk_";
// Last touch within 180 days (DECISIONS B-08). Phase 7 owns the full matching
// rules; here it only enriches the purchase event.
export const ATTRIBUTION_WINDOW_DAYS = 180;

export function newHookToken(): string {
  return `${HOOK_TOKEN_PREFIX}${randomToken(24)}`;
}

export async function ensureHookToken(db: Db, key: string, accountId: string): Promise<string> {
  const [row] = await db.select().from(inboundHookSecrets).where(eq(inboundHookSecrets.accountId, accountId));
  if (row) return decryptSecret(row.tokenEnc, key);
  const token = newHookToken();
  await db
    .insert(inboundHookSecrets)
    .values({ accountId, tokenHash: sha256Hex(token), tokenEnc: encryptSecret(token, key) })
    .onConflictDoNothing();
  // A parallel request may have created it first; read back what won.
  const [created] = await db.select().from(inboundHookSecrets).where(eq(inboundHookSecrets.accountId, accountId));
  return decryptSecret(created!.tokenEnc, key);
}

export async function rotateHookToken(db: Db, key: string, accountId: string, now = new Date()): Promise<string> {
  const token = newHookToken();
  await db
    .insert(inboundHookSecrets)
    .values({ accountId, tokenHash: sha256Hex(token), tokenEnc: encryptSecret(token, key), rotatedAt: now })
    .onConflictDoUpdate({ target: inboundHookSecrets.accountId, set: { tokenHash: sha256Hex(token), tokenEnc: encryptSecret(token, key), rotatedAt: now } });
  return token;
}

export async function accountForToken(db: Db, token: string): Promise<{ accountId: string; active: boolean } | null> {
  if (!token.startsWith(HOOK_TOKEN_PREFIX)) return null;
  const [row] = await db
    .select({ accountId: inboundHookSecrets.accountId, status: accounts.status })
    .from(inboundHookSecrets)
    .innerJoin(accounts, eq(accounts.id, inboundHookSecrets.accountId))
    .where(eq(inboundHookSecrets.tokenHash, sha256Hex(token)));
  return row ? { accountId: row.accountId, active: row.status === "active" } : null;
}

export interface Touch {
  clickId: string | null;
  linkId: string | null;
  replyId: string | null;
  campaignId: string | null;
  youtubeVideoId: string | null;
  keyword: string | null;
  tid: string;
}

// The click a tracking id points at. A tid of another account, or one we never
// issued, is treated as unknown: it never attributes and never leaks.
export async function resolveTid(db: Db, accountId: string, tid: string): Promise<Touch | null> {
  const [click] = await db
    .select()
    .from(clicks)
    .where(and(eq(clicks.tid, tid), eq(clicks.accountId, accountId), eq(clicks.isBot, false)));
  if (!click) return null;
  return {
    clickId: click.id,
    linkId: click.linkId,
    replyId: click.replyId,
    campaignId: click.campaignId,
    youtubeVideoId: click.youtubeVideoId,
    keyword: click.keyword,
    tid,
  };
}

// The most recent attributed opt-in of this email in the 180 days before `at`.
export async function latestTouchByEmail(db: Db, accountId: string, emailNorm: string, at: Date): Promise<Touch | null> {
  const since = new Date(at.getTime() - ATTRIBUTION_WINDOW_DAYS * 86_400_000);
  const touches = await db
    .select()
    .from(subscribers)
    .where(and(eq(subscribers.accountId, accountId), eq(subscribers.emailNorm, emailNorm), gte(subscribers.occurredAt, since), lte(subscribers.occurredAt, at)))
    .orderBy(desc(subscribers.occurredAt))
    .limit(20);
  const hit = touches.find((s) => s.campaignId || s.keyword);
  return hit
    ? {
        clickId: hit.clickId,
        linkId: hit.linkId,
        replyId: hit.replyId,
        campaignId: hit.campaignId,
        youtubeVideoId: hit.youtubeVideoId,
        keyword: hit.keyword,
        tid: hit.tid ?? "",
      }
    : null;
}

async function campaignInfo(db: Db, campaignId: string | null) {
  if (!campaignId) return { channelId: null, name: null };
  const [row] = await db.select({ channelId: campaigns.channelId, name: campaigns.name, intent: campaigns.intent }).from(campaigns).where(eq(campaigns.id, campaignId));
  return { channelId: row?.channelId ?? null, name: row?.name ?? null, intent: row?.intent ?? null };
}

export interface RecordedOptIn {
  id: string | null;
  created: boolean;
  attributed: boolean;
}

export async function recordOptIn(
  db: Db,
  accountId: string,
  input: OptInInput,
  options: { source: SubscriberSource; ghlContactId?: string | null; emit: Emit },
): Promise<RecordedOptIn> {
  const touch = input.tid ? await resolveTid(db, accountId, input.tid) : null;
  const [row] = await db
    .insert(subscribers)
    .values({
      accountId,
      emailNorm: input.email,
      name: input.name,
      source: options.source,
      externalId: input.externalId,
      dedupeKey: input.externalId ?? input.tid ?? "none",
      tid: input.tid,
      clickId: touch?.clickId ?? null,
      linkId: touch?.linkId ?? null,
      replyId: touch?.replyId ?? null,
      campaignId: touch?.campaignId ?? null,
      youtubeVideoId: touch?.youtubeVideoId ?? null,
      keyword: touch?.keyword ?? null,
      consentMarketing: input.consentMarketing,
      ghlContactId: options.ghlContactId ?? null,
      occurredAt: input.occurredAt,
    })
    .onConflictDoNothing()
    .returning({ id: subscribers.id });
  if (!row) return { id: null, created: false, attributed: Boolean(touch) };

  const campaign = await campaignInfo(db, touch?.campaignId ?? null);
  await options.emit({
    accountId,
    event: "opt_in",
    occurredAt: input.occurredAt,
    // The event id is the subscriber row, so a retry of the same opt-in can
    // never produce a second event.
    eventId: row.id,
    context: {
      channelId: campaign.channelId,
      videoId: touch?.youtubeVideoId ?? null,
      campaignId: touch?.campaignId ?? null,
      campaign: campaign.name,
      keyword: touch?.keyword ?? null,
      intent: campaign.intent ?? null,
      replyId: touch?.replyId ?? null,
      tid: input.tid,
      email: input.email,
      source: options.source,
    },
  });
  return { id: row.id, created: true, attributed: Boolean(touch) };
}

export interface RecordedPurchase {
  id: string;
  created: boolean;
  refundUpdated: boolean;
}

export async function recordPurchase(
  db: Db,
  accountId: string,
  input: PurchaseInput,
  options: { source: PurchaseSource; ghlContactId?: string | null; raw?: Record<string, unknown>; emit: Emit },
): Promise<RecordedPurchase> {
  const kind = input.amountCents === null ? "buyer_marker" : "payment";
  const [inserted] = await db
    .insert(purchases)
    .values({
      accountId,
      source: options.source,
      kind,
      externalId: input.externalId,
      emailNorm: input.email,
      tid: input.tid,
      amountCents: input.amountCents,
      currency: input.currency,
      refundedCents: input.refundedCents ?? 0,
      subscriptionRef: input.subscriptionId,
      ghlContactId: options.ghlContactId ?? null,
      occurredAt: input.occurredAt,
      raw: options.raw ?? {},
    })
    .onConflictDoNothing()
    .returning({ id: purchases.id });

  if (!inserted) {
    // Seen before: a retry, or the same order with a refund or new details.
    const [existing] = await db
      .select()
      .from(purchases)
      .where(and(eq(purchases.accountId, accountId), eq(purchases.source, options.source), eq(purchases.externalId, input.externalId)));
    const fill = {
      ...(input.refundedCents !== null && input.refundedCents !== existing!.refundedCents ? { refundedCents: input.refundedCents } : {}),
      ...(existing!.amountCents === null && input.amountCents !== null ? { amountCents: input.amountCents, currency: input.currency, kind: "payment" as const } : {}),
      ...(!existing!.emailNorm && input.email ? { emailNorm: input.email } : {}),
      ...(!existing!.tid && input.tid ? { tid: input.tid } : {}),
    };
    if (Object.keys(fill).length > 0) await db.update(purchases).set({ ...fill, updatedAt: new Date() }).where(eq(purchases.id, existing!.id));
    return { id: existing!.id, created: false, refundUpdated: "refundedCents" in fill };
  }

  const touch = (input.tid ? await resolveTid(db, accountId, input.tid) : null) ?? (input.email ? await latestTouchByEmail(db, accountId, input.email, input.occurredAt) : null);
  const campaign = await campaignInfo(db, touch?.campaignId ?? null);
  await options.emit({
    accountId,
    event: "purchase",
    occurredAt: input.occurredAt,
    eventId: inserted.id,
    context: {
      channelId: campaign.channelId,
      videoId: touch?.youtubeVideoId ?? null,
      campaignId: touch?.campaignId ?? null,
      campaign: campaign.name,
      keyword: touch?.keyword ?? null,
      intent: campaign.intent ?? null,
      replyId: touch?.replyId ?? null,
      tid: input.tid ?? (touch?.tid || null),
      email: input.email,
      source: options.source,
      amountCents: input.amountCents,
      currency: input.currency,
      // Only a buyer we can trace to a comment is a c2c buyer.
      buyer: Boolean(touch),
    },
  });
  return { id: inserted.id, created: true, refundUpdated: false };
}
