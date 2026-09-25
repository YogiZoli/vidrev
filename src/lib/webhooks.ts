import { hmacSha256Hex, safeEqual } from "./crypto";
import { c2cTags } from "./tags";

// Outbound webhooks (SPEC section 11, DECISIONS D-03). Pure helpers: payload,
// signature and retry schedule. Delivery lives in src/worker/webhooks.ts.

export const EVENT_NAMES = ["comment_matched", "reply_posted", "link_clicked", "opt_in", "purchase"] as const;
export type EventName = (typeof EVENT_NAMES)[number];
// "ping" is the test event a creator sends to an endpoint by hand.
export type DeliveredEvent = EventName | "ping";

export function isEventName(value: string): value is EventName {
  return (EVENT_NAMES as readonly string[]).includes(value);
}

export interface EventContext {
  channelId?: string | null;
  videoId?: string | null;
  campaignId?: string | null;
  campaign?: string | null;
  keyword?: string | null;
  intent?: string | null;
  replyId?: string | null;
  // Our opaque id of the person (DECISIONS section 13); never a YouTube id.
  contactId?: string | null;
  tid?: string | null;
  // opt_in and purchase only
  email?: string | null;
  source?: string | null;
  amountCents?: number | null;
  currency?: string | null;
  buyer?: boolean;
}

// Deliberately no comment text, commenter names or ids: YouTube API data does
// not leave the app (DECISIONS Q-17 c). Consent and identity are the creator's.
export function buildEventPayload(input: {
  event: DeliveredEvent;
  id: string;
  occurredAt: Date;
  accountId: string;
  context?: EventContext;
}): Record<string, unknown> {
  const c = input.context ?? {};
  const payload: Record<string, unknown> = {
    event: input.event,
    id: input.id,
    occurred_at: input.occurredAt.toISOString(),
    account_id: input.accountId,
  };
  if (input.event === "ping") return payload;
  payload.channel_id = c.channelId ?? null;
  payload.video_id = c.videoId ?? null;
  payload.campaign_id = c.campaignId ?? null;
  payload.campaign = c.campaign ?? null;
  payload.keyword = c.keyword ?? null;
  payload.intent = c.intent ?? null;
  payload.tid = c.tid ?? null;
  if (c.replyId) payload.reply_id = c.replyId;
  if (c.contactId) payload.contact_id = c.contactId;
  if (input.event === "opt_in" || input.event === "purchase") {
    payload.email = c.email ?? null;
    payload.source = c.source ?? null;
  }
  if (input.event === "purchase") {
    payload.amount_cents = c.amountCents ?? null;
    payload.currency = c.currency ?? null;
  }
  // Ready to apply in any CRM, Zapier, Make or n8n.
  payload.tags = c2cTags({ keyword: c.keyword, videoId: c.videoId, buyer: input.event === "purchase" ? c.buyer : false });
  return payload;
}

const SIGNATURE_PREFIX = "sha256=";

// X-Signature: sha256=<hex HMAC-SHA256 of the raw body>.
export function signBody(rawBody: string, secret: string): string {
  return `${SIGNATURE_PREFIX}${hmacSha256Hex(rawBody, secret)}`;
}

export function verifySignature(rawBody: string, header: string | null | undefined, secret: string): boolean {
  if (!header) return false;
  const provided = header.trim().replace(/^sha256=/i, "").toLowerCase();
  return safeEqual(provided, hmacSha256Hex(rawBody, secret));
}

// Retries with exponential backoff for 24 hours: 1 min, 5 min, 15 min, 1 h,
// 3 h, 6 h, 12 h after the failed attempts 1 to 7; after the 8th failure the
// delivery is dead. The last retry lands about 22 hours after the event.
export const RETRY_DELAYS_SECONDS = [60, 300, 900, 3600, 10_800, 21_600, 43_200] as const;
export const MAX_DELIVERY_AGE_MS = 24 * 3_600_000;

// `attempts` counts the attempts made so far, including the one that just
// failed. Null means give up.
export function nextAttemptAt(attempts: number, createdAt: Date, now: Date): Date | null {
  const delay = RETRY_DELAYS_SECONDS[attempts - 1];
  if (delay === undefined) return null;
  const next = new Date(now.getTime() + delay * 1000);
  return next.getTime() - createdAt.getTime() > MAX_DELIVERY_AGE_MS ? null : next;
}

// whsec_ + 32 random characters; shown to the creator, never logged.
export const SECRET_PREFIX = "whsec_";
