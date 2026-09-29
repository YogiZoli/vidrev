import { and, desc, eq, gte, lte, or } from "drizzle-orm";
import type { Db } from "@/db/client";
import { accounts, campaigns, clicks, inboundHookSecrets, purchases, subscribers, type PurchaseSource, type SubscriberSource } from "@/db/schema";
import { decryptSecret, encryptSecret, randomToken, sha256Hex } from "@/lib/crypto";
import type { OptInInput, PurchaseInput } from "@/lib/inbound";
import { ATTRIBUTION_WINDOW_DAYS } from "@/lib/attribution";
import { markReportDirty } from "../attribution";
import { attachClickToContact, contactForTouch, resolveContact } from "../contacts";
import type { EmitInput } from "./events";

// Recording of opt-ins and purchases from any source (SPEC sections 9, 10):
// the universal inbound hooks, GHL and later Stripe all end up here.

export type Emit = (input: EmitInput) => Promise<void>;

export const HOOK_TOKEN_PREFIX = "vidrev_hk_";

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
// Enriches the outbound purchase event only; reports use the full rules in
// src/lib/attribution.ts, recomputed by the worker.
export async function latestTouchByPerson(db: Db, accountId: string, person: { contactId: string | null; emailNorm: string | null }, at: Date): Promise<Touch | null> {
  const since = new Date(at.getTime() - ATTRIBUTION_WINDOW_DAYS * 86_400_000);
  const who = [person.contactId ? eq(subscribers.contactId, person.contactId) : undefined, person.emailNorm ? eq(subscribers.emailNorm, person.emailNorm) : undefined].filter((c) => c !== undefined);
  if (who.length === 0) return null;
  const touches = await db
    .select()
    .from(subscribers)
    .where(and(eq(subscribers.accountId, accountId), or(...who), gte(subscribers.occurredAt, since), lte(subscribers.occurredAt, at)))
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
  // The person: the Contact the tracking id points to, else the one the email
  // belongs to, else a new one. Never a duplicate (DECISIONS Q-23, section 13).
  const person = await resolveContact(db, {
    accountId,
    keys: { email: input.email, ghlContact: options.ghlContactId },
    anchors: [await contactForTouch(db, accountId, touch)],
    event: "opt_in",
    createdVia: options.source === "ghl" ? "crm_sync" : "opt_in",
    source: `opt_in:${options.source}`,
    at: input.occurredAt,
    displayName: input.name,
  });
  await attachClickToContact(db, accountId, touch?.clickId ?? null, person.contactId);
  const [row] = await db
    .insert(subscribers)
    .values({
      accountId,
      emailNorm: input.email,
      contactId: person.contactId,
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
      contactId: person.contactId,
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
  options: { source: PurchaseSource; ghlContactId?: string | null; stripeCustomerId?: string | null; raw?: Record<string, unknown>; emit: Emit },
): Promise<RecordedPurchase> {
  const kind = input.amountCents === null ? "buyer_marker" : "payment";
  // The buyer is a Contact too: by tracking id, email, or the CRM and Stripe
  // ids; a returning buyer, or one who commented before, is the same person.
  const [known] = await db
    .select({ contactId: purchases.contactId })
    .from(purchases)
    .where(and(eq(purchases.accountId, accountId), eq(purchases.source, options.source), eq(purchases.externalId, input.externalId)));
  const tidTouch = input.tid ? await resolveTid(db, accountId, input.tid) : null;
  const anchors = [await contactForTouch(db, accountId, tidTouch), known?.contactId];
  const keys = { email: input.email, ghlContact: options.ghlContactId, stripeCustomer: options.stripeCustomerId };
  const person =
    input.email || options.ghlContactId || options.stripeCustomerId || anchors.some(Boolean)
      ? await resolveContact(db, {
          accountId,
          keys,
          anchors,
          event: "purchase",
          createdVia: options.source === "ghl" ? "crm_sync" : "purchase",
          source: `purchase:${options.source}`,
          at: input.occurredAt,
        })
      : null;
  const [inserted] = await db
    .insert(purchases)
    .values({
      accountId,
      source: options.source,
      kind,
      externalId: input.externalId,
      emailNorm: input.email,
      contactId: person?.contactId ?? null,
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
      ...(person && existing!.contactId !== person.contactId ? { contactId: person.contactId } : {}),
    };
    if (Object.keys(fill).length > 0) {
      await db.update(purchases).set({ ...fill, updatedAt: new Date() }).where(eq(purchases.id, existing!.id));
      // A refund or a late email changes revenue and attribution.
      await markReportDirty(db, accountId);
    }
    return { id: existing!.id, created: false, refundUpdated: "refundedCents" in fill };
  }

  const touch = tidTouch ?? (await latestTouchByPerson(db, accountId, { contactId: person?.contactId ?? null, emailNorm: input.email }, input.occurredAt));
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
      contactId: person?.contactId ?? null,
      tid: input.tid ?? (touch?.tid || null),
      email: input.email,
      source: options.source,
      amountCents: input.amountCents,
      currency: input.currency,
      // Only a buyer we can trace to a comment is a vidrev buyer.
      buyer: Boolean(touch),
    },
  });
  return { id: inserted.id, created: true, refundUpdated: false };
}
