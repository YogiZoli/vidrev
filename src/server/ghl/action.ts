import { and, desc, eq, isNotNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { contactIdentities, contacts, integrations, links, subscribers } from "@/db/schema";
import { safeEqual } from "@/lib/crypto";

// The marketplace workflow action "Find the video behind this contact"
// (DECISIONS P10-05). HighLevel POSTs { data, extras, meta } to the Execution
// URL when a workflow reaches the step; what we answer becomes variables for
// the steps after it. It reads only our own first-party rows, so it answers in
// the web request without any external call; the optional note goes through
// the worker.

export interface ActionRequest {
  locationId: string;
  contactId: string;
  addNote: boolean;
}

// Fields are configured in the Marketplace portal; a missing or unknown
// "add_note" value means yes, only an explicit no/false turns the note off.
export function parseActionRequest(body: unknown): ActionRequest | null {
  if (!body || typeof body !== "object") return null;
  const { data, extras } = body as { data?: Record<string, unknown>; extras?: Record<string, unknown> };
  const locationId = typeof extras?.locationId === "string" ? extras.locationId : "";
  const contactId = typeof extras?.contactId === "string" ? extras.contactId : "";
  if (!locationId || !contactId) return null;
  const flag = String(data?.add_note ?? "yes").trim().toLowerCase();
  return { locationId, contactId, addNote: !["no", "false", "0", "off"].includes(flag) };
}

// The Execution URL is public, so the portal is set up to send a shared secret
// header with every call.
export function verifyActionKey(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  return safeEqual(header.trim(), secret);
}

export interface SourceInfo {
  videoId: string;
  videoUrl: string;
  keyword: string;
  intent: string | null;
  stage: string;
  optedInAt: Date;
}

export type SourceLookup =
  | { status: "ok"; accountId: string; integrationId: string; source: SourceInfo }
  | { status: "no_source"; accountId: string; integrationId: string }
  | { status: "unknown_location" };

// The latest attributed opt-in of the person behind this HighLevel contact.
// The HighLevel contact id is one of the Contact's identities (Q-23).
export async function findSource(db: Db, locationId: string, ghlContactId: string): Promise<SourceLookup> {
  const [integration] = await db
    .select({ id: integrations.id, accountId: integrations.accountId })
    .from(integrations)
    .where(and(eq(integrations.type, "ghl"), eq(integrations.externalRef, locationId), eq(integrations.status, "active")));
  if (!integration) return { status: "unknown_location" };
  const base = { accountId: integration.accountId, integrationId: integration.id };

  const [identity] = await db
    .select({ contactId: contactIdentities.contactId })
    .from(contactIdentities)
    .where(and(eq(contactIdentities.accountId, integration.accountId), eq(contactIdentities.kind, "ghl_contact"), eq(contactIdentities.value, ghlContactId)));
  if (!identity) return { status: "no_source", ...base };

  const [touch] = await db
    .select({ videoId: subscribers.youtubeVideoId, keyword: subscribers.keyword, occurredAt: subscribers.occurredAt, intent: links.intent, stage: contacts.stage })
    .from(subscribers)
    .innerJoin(contacts, eq(contacts.id, subscribers.contactId))
    .leftJoin(links, eq(links.id, subscribers.linkId))
    .where(and(eq(subscribers.accountId, integration.accountId), eq(subscribers.contactId, identity.contactId), isNotNull(subscribers.keyword)))
    .orderBy(desc(subscribers.occurredAt))
    .limit(1);
  if (!touch?.videoId || !touch.keyword) return { status: "no_source", ...base };

  return {
    status: "ok",
    ...base,
    source: {
      videoId: touch.videoId,
      videoUrl: `https://www.youtube.com/watch?v=${touch.videoId}`,
      keyword: touch.keyword,
      intent: touch.intent,
      stage: touch.stage,
      optedInAt: touch.occurredAt,
    },
  };
}

// The variables the workflow can use after the step. Always the same keys, so a
// workflow never breaks on a missing one.
export function actionResponse(lookup: SourceLookup): Record<string, string> {
  const ok = lookup.status === "ok" ? lookup.source : null;
  return {
    found: ok ? "yes" : "no",
    video_id: ok?.videoId ?? "",
    video_url: ok?.videoUrl ?? "",
    keyword: ok?.keyword ?? "",
    intent: ok?.intent ?? "",
    stage: ok?.stage ?? "",
    opted_in_at: ok?.optedInAt.toISOString() ?? "",
  };
}

// Plain text for the contact's note in HighLevel. Only first-party facts:
// never a comment, a commenter name or a video title (YouTube data).
export function noteText(source: SourceInfo, product: string): string {
  return [
    `${product} source`,
    `Video: ${source.videoUrl}`,
    `Keyword: ${source.keyword}${source.intent ? ` (${source.intent})` : ""}`,
    `Opted in: ${source.optedInAt.toISOString().replace("T", " ").slice(0, 16)} UTC`,
  ].join("\n");
}
