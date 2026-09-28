import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { accounts, campaigns, channels, comments, plans, replies, templates, users } from "@/db/schema";
import { decryptSecret } from "@/lib/crypto";
import { matchComment } from "@/lib/keywords";
import { detectLanguage, pickReplyLanguage } from "@/lib/language";
import { log } from "@/lib/log";
import { LINK_PLACEHOLDER } from "@/lib/templates";
import { type AiConfig, buildPrompt, cleanDraft, DEFAULT_MODELS, generateText } from "@/server/ai";
import { draftsWaitingEmail } from "@/server/email/templates";
import { resolveContact } from "@/server/contacts";
import { emitEventSafely, kickWith } from "@/server/integrations/events";
import type { FetchLike } from "@/server/google/oauth";
import { replyUsage } from "@/server/replies";
import type { Enqueue } from "./polling";

export interface DraftDeps {
  db: Db;
  fetch: FetchLike;
  encryptionKey: string | undefined;
  platformAi: { apiKey: string | undefined; model: string };
  appBaseUrl: string;
  productName: string;
  enqueue: Enqueue;
  now?: () => Date;
}

// Used when a campaign has no template and the AI is unavailable. The
// creator still approves (and can edit) every draft before it is sent.
const FALLBACK_BODY = `Here you go: ${LINK_PLACEHOLDER}`;
// At most one "drafts are waiting" email per account per hour (R-35).
const NOTIFY_INTERVAL_MS = 3_600_000;

function aiConfig(deps: DraftDeps, account: typeof accounts.$inferSelect): AiConfig | null {
  if (account.aiProvider === "platform") {
    return deps.platformAi.apiKey ? { provider: "gemini", apiKey: deps.platformAi.apiKey, model: deps.platformAi.model } : null;
  }
  if (!account.aiKeyEnc || !deps.encryptionKey) return null;
  return {
    provider: account.aiProvider,
    apiKey: decryptSecret(account.aiKeyEnc, deps.encryptionKey),
    model: account.aiModel ?? DEFAULT_MODELS[account.aiProvider],
  };
}

// Turns a stored keyword comment into a draft waiting for approval (D-25).
// One reply per comment (Q-10b); the best match is chosen, the others are
// kept so the creator can switch on the approval card.
export async function createDraft(deps: DraftDeps, commentId: string): Promise<void> {
  const now = deps.now?.() ?? new Date();
  const [row] = await deps.db
    .select({ comment: comments, channel: channels, account: accounts, plan: plans })
    .from(comments)
    .innerJoin(channels, eq(channels.id, comments.channelId))
    .innerJoin(accounts, eq(accounts.id, channels.accountId))
    .innerJoin(plans, eq(plans.code, accounts.planCode))
    .where(eq(comments.id, commentId));
  if (!row) return;
  const { comment, channel, account, plan } = row;
  const [existing] = await deps.db.select({ id: replies.id }).from(replies).where(eq(replies.commentId, comment.id));
  if (existing) return;

  const active = await deps.db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.channelId, channel.id), eq(campaigns.active, true)));
  const matches = matchComment({ text: comment.text, videoId: comment.youtubeVideoId, publishedAt: comment.publishedAt }, active);
  const best = matches[0];
  if (!best) return;
  const campaign = active.find((c) => c.id === best.campaignId)!;

  const campaignTemplates = await deps.db
    .select()
    .from(templates)
    .where(eq(templates.campaignId, campaign.id))
    .orderBy(sql`${templates.lastUsedAt} asc nulls first`, asc(templates.createdAt));
  const detected = detectLanguage(comment.text);
  const language = pickReplyLanguage({
    commentLanguage: detected,
    channelDefault: channel.defaultLanguage,
    templateLanguages: campaignTemplates.map((t) => t.language),
  });
  const inLanguage = campaignTemplates.filter((t) => t.language === language);
  // Rotation: the least recently used approved template (varied replies).
  const template = inLanguage[0] ?? null;

  let body: string | null = null;
  const config = aiConfig(deps, account);
  if (config) {
    try {
      const prompt = buildPrompt({
        campaignName: campaign.name,
        keyword: campaign.keyword,
        commentText: comment.text,
        language,
        examples: inLanguage.slice(0, 3).map((t) => t.body),
      });
      body = cleanDraft(await generateText(config, prompt, deps.fetch));
    } catch (error) {
      log("warn", "AI draft failed, using template", { accountId: account.id, error: String(error) });
    }
  }
  const draftSource = body ? "ai" : "template";
  body ??= template?.body ?? FALLBACK_BODY;

  // The monthly plan cap is checked here too, so the creator sees at once
  // why a comment will not get an API reply (SPEC section 6).
  const usage = await replyUsage(deps.db, account.id, now);
  const overCap = plan.monthlyReplyCap !== null && usage.thisMonth >= plan.monthlyReplyCap;

  // The person behind the comment: the same commenter on another video is the
  // same Contact (DECISIONS Q-23, section 13). Recognised by the channel id.
  const person = await resolveContact(deps.db, {
    accountId: account.id,
    keys: { youtubeChannel: comment.authorChannelId, commentFallback: comment.youtubeCommentId },
    event: "comment",
    createdVia: "comment",
    source: "youtube_comment",
    at: comment.fetchedAt,
    channelId: channel.id,
    refCommentId: comment.youtubeCommentId,
  });

  const [inserted] = await deps.db
    .insert(replies)
    .values({
      accountId: account.id,
      channelId: channel.id,
      commentId: comment.id,
      contactId: person.contactId,
      campaignId: campaign.id,
      templateId: template?.id ?? null,
      youtubeVideoId: comment.youtubeVideoId,
      keyword: campaign.keyword,
      intent: campaign.intent,
      otherMatches: matches.slice(1).map((m) => ({ campaignId: m.campaignId, keyword: m.keyword, intent: m.intent })),
      language,
      body,
      draftSource,
      status: overCap ? "skipped" : "pending_approval",
      statusReason: overCap ? "monthly_cap" : null,
    })
    .onConflictDoNothing()
    .returning({ id: replies.id });
  if (!inserted) return;
  // Outbound event (Phase 6): keyword, video and campaign, never the comment.
  await emitEventSafely(
    deps.db,
    {
      accountId: account.id,
      event: "comment_matched",
      occurredAt: comment.publishedAt,
      context: {
        channelId: channel.id,
        videoId: comment.youtubeVideoId,
        campaignId: campaign.id,
        campaign: campaign.name,
        keyword: campaign.keyword,
        intent: campaign.intent,
        replyId: inserted.id,
        contactId: person.contactId,
      },
    },
    kickWith(deps.enqueue),
  );
  await deps.db.update(comments).set({ language: detected }).where(eq(comments.id, comment.id));
  if (template) await deps.db.update(templates).set({ lastUsedAt: now }).where(eq(templates.id, template.id));
  if (!overCap) await notifyDraftsWaiting(deps, account, now);
}

async function notifyDraftsWaiting(deps: DraftDeps, account: typeof accounts.$inferSelect, now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - NOTIFY_INTERVAL_MS);
  // Claim the notification slot atomically so parallel drafts send one email.
  const claimed = await deps.db
    .update(accounts)
    .set({ draftsNotifiedAt: now })
    .where(and(eq(accounts.id, account.id), sql`(${accounts.draftsNotifiedAt} is null or ${accounts.draftsNotifiedAt} < ${cutoff})`))
    .returning({ id: accounts.id });
  if (claimed.length === 0) return;
  const [pending] = await deps.db
    .select({ n: sql<number>`count(*)::int` })
    .from(replies)
    .where(and(eq(replies.accountId, account.id), eq(replies.status, "pending_approval")));
  const recipients = await deps.db.select({ email: users.email }).from(users).where(eq(users.accountId, account.id));
  for (const { email } of recipients) {
    await deps.enqueue(
      "email.send",
      draftsWaitingEmail({ to: email, count: pending?.n ?? 1, url: `${deps.appBaseUrl}/app`, productName: deps.productName }),
    );
  }
}
