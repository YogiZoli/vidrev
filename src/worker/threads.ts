import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { comments, crmProspects, integrations, replies } from "@/db/schema";
import { env } from "@/lib/env";
import { errorFields, log } from "@/lib/log";
import { LINK_PLACEHOLDER } from "@/lib/templates";
import { approveReply } from "@/server/approval";
import { GhlReauthError, withGhlApi } from "@/server/ghl/tokens";
import type { GhlWorkerDeps } from "./ghl";

// Beast Mode Conversations thread (DECISIONS A-25, C2C port 4). The comment
// and our draft go into the prospect's thread as one inbound message; the
// creator answers in the CRM ("OK" posts the draft, any other text is the
// reply). That answer goes through the normal approval and sending path:
// nothing is posted without the creator, never twice.

export const APPROVE_WORDS = new Set(["ok", "okay", "yes", "send", "approve"]);

export function threadMessage(input: { videoId: string; keyword: string; commentText: string; draft: string }): string {
  return [
    `YouTube comment on https://youtu.be/${input.videoId} (keyword ${input.keyword}):`,
    "",
    input.commentText,
    "",
    "Suggested reply:",
    input.draft,
    "",
    `Reply OK to post the suggestion, or write your own reply. ${LINK_PLACEHOLDER} is where your tracked link goes; it is added at the end if you leave it out. Nothing is posted until you send.`,
  ].join("\n");
}

// The creator's text from the CRM into a reply body: OK means the draft as it is.
export function replyBodyFrom(text: string, draft: string): string {
  const clean = text.trim();
  if (APPROVE_WORDS.has(clean.toLowerCase().replace(/[.!]+$/, ""))) return draft;
  return clean.includes(LINK_PLACEHOLDER) ? clean : `${clean} ${LINK_PLACEHOLDER}`;
}

function providerId(): string | null {
  return env().GHL_CONVERSATION_PROVIDER_ID ?? null;
}

// Job ghl.thread: one comment and its draft into the prospect's thread.
export async function pushToThread(deps: GhlWorkerDeps & { providerId?: string | null }, replyId: string): Promise<"done" | "no_provider" | "no_prospect" | "no_comment" | "posted"> {
  const provider = deps.providerId === undefined ? providerId() : deps.providerId;
  if (!provider) return "no_provider";
  const now = deps.now?.() ?? new Date();
  const [reply] = await deps.db.select().from(replies).where(eq(replies.id, replyId));
  if (!reply?.contactId) return "no_prospect";
  if (reply.crmThreadedAt) return "done";
  const [prospect] = await deps.db
    .select()
    .from(crmProspects)
    .where(and(eq(crmProspects.accountId, reply.accountId), eq(crmProspects.contactId, reply.contactId), eq(crmProspects.status, "created")));
  if (!prospect?.ghlContactId || !prospect.integrationId) return "no_prospect";
  const [comment] = reply.commentId ? await deps.db.select({ text: comments.text }).from(comments).where(eq(comments.id, reply.commentId)) : [];
  if (!comment) return "no_comment";
  try {
    await withGhlApi(deps, prospect.integrationId, async (api, config) => {
      let conversationId = prospect.ghlConversationId;
      if (!conversationId) {
        conversationId = await api.createConversation(config.locationId, prospect.ghlContactId!, provider);
        await deps.db.update(crmProspects).set({ ghlConversationId: conversationId, updatedAt: now }).where(eq(crmProspects.id, prospect.id));
      }
      await api.addInboundMessage(conversationId, provider, threadMessage({ videoId: reply.youtubeVideoId, keyword: reply.keyword, commentText: comment.text, draft: reply.body }));
    });
  } catch (error) {
    if (error instanceof GhlReauthError) return "no_prospect";
    throw error;
  }
  await deps.db.update(replies).set({ crmThreadedAt: now }).where(eq(replies.id, reply.id));
  return "posted";
}

export type OutboundOutcome = "ignored" | "unknown_location" | "not_verified" | "no_prospect" | "no_draft" | "duplicate" | "refused" | "approved";

// Job ghl.outbound: the delivery URL announced a message the creator sent in
// the CRM. The payload is never trusted: the message is read back with our
// own token and must be outbound, in our provider's thread, on our prospect.
export async function handleOutbound(deps: GhlWorkerDeps & { providerId?: string | null }, payload: Record<string, unknown>): Promise<OutboundOutcome> {
  const provider = deps.providerId === undefined ? providerId() : deps.providerId;
  const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
  const locationId = str(payload.locationId);
  const messageId = str(payload.messageId) ?? str(payload.id);
  if (!provider || !locationId || !messageId) return "ignored";
  const [integration] = await deps.db
    .select({ id: integrations.id, accountId: integrations.accountId })
    .from(integrations)
    .where(and(eq(integrations.type, "ghl"), eq(integrations.externalRef, locationId), eq(integrations.status, "active")));
  if (!integration) return "unknown_location";

  try {
    return await withGhlApi(deps, integration.id, async (api) => {
      const message = await api.getMessage(messageId);
      const fail = async (reason: string) => {
        await api.setMessageStatus(messageId, "failed", reason).catch((error: unknown) => log("warn", "crm message status not set", { messageId, ...errorFields(error) }));
      };
      if (!message || !message.contactId || (message.direction && message.direction !== "outbound")) return "not_verified";
      if (message.conversationProviderId && message.conversationProviderId !== provider) return "not_verified";
      const [prospect] = await deps.db
        .select()
        .from(crmProspects)
        .where(and(eq(crmProspects.ghlLocationId, locationId), eq(crmProspects.ghlContactId, message.contactId), eq(crmProspects.status, "created")));
      if (!prospect || prospect.accountId !== integration.accountId) return "no_prospect";
      if (message.conversationId && prospect.ghlConversationId && message.conversationId !== prospect.ghlConversationId) return "not_verified";
      const [seen] = await deps.db.select({ id: replies.id }).from(replies).where(and(eq(replies.accountId, prospect.accountId), eq(replies.crmMessageId, messageId)));
      if (seen) return "duplicate";
      // The newest comment of this person still waiting for a reply.
      const [reply] = await deps.db
        .select()
        .from(replies)
        .where(and(eq(replies.accountId, prospect.accountId), eq(replies.contactId, prospect.contactId), eq(replies.status, "pending_approval")))
        .orderBy(desc(replies.createdAt))
        .limit(1);
      if (!reply) {
        await fail("No comment from this person is waiting for a reply.");
        return "no_draft";
      }
      const text = message.body ?? str(payload.message) ?? "";
      if (!text.trim()) return "not_verified";
      const result = await approveReply(deps.db, { accountId: prospect.accountId, replyId: reply.id, body: replyBodyFrom(text, reply.body) }, deps.now?.() ?? new Date());
      if (!result.ok) {
        await fail(`Not posted: ${result.error.replace(/_/g, " ")}.`);
        log("warn", "crm reply refused", { accountId: prospect.accountId, replyId: reply.id, reason: result.error });
        return "refused";
      }
      await deps.db.update(replies).set({ crmMessageId: messageId }).where(eq(replies.id, reply.id));
      log("info", "reply approved from the crm thread", { accountId: prospect.accountId, replyId: reply.id });
      return "approved";
    });
  } catch (error) {
    if (error instanceof GhlReauthError) return "unknown_location";
    throw error;
  }
}

// Engine tick: the CRM message that approved a reply shows delivered once it
// is posted on YouTube, failed when the send failed.
export async function syncThreadStatuses(deps: GhlWorkerDeps): Promise<number> {
  const now = deps.now?.() ?? new Date();
  const rows = await deps.db
    .select({ id: replies.id, accountId: replies.accountId, status: replies.status, crmMessageId: replies.crmMessageId })
    .from(replies)
    .where(and(isNotNull(replies.crmMessageId), isNull(replies.crmStatusSentAt), inArray(replies.status, ["sent", "sent_manually", "failed"])))
    .limit(50);
  let done = 0;
  for (const row of rows) {
    const [ghl] = await deps.db
      .select({ id: integrations.id })
      .from(integrations)
      .where(and(eq(integrations.accountId, row.accountId), eq(integrations.type, "ghl"), eq(integrations.status, "active")));
    try {
      if (ghl) {
        await withGhlApi(deps, ghl.id, (api) =>
          api.setMessageStatus(row.crmMessageId!, row.status === "failed" ? "failed" : "delivered", row.status === "failed" ? "Posting to YouTube failed. See vidrev." : undefined),
        );
      }
    } catch (error) {
      if (!(error instanceof GhlReauthError)) {
        log("warn", "crm message status sync failed", { replyId: row.id, ...errorFields(error) });
        continue;
      }
    }
    await deps.db.update(replies).set({ crmStatusSentAt: now }).where(eq(replies.id, row.id));
    done += 1;
  }
  return done;
}
