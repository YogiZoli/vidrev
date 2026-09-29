import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { type AiProvider, accounts, campaigns, channels, comments, type Intent, replies, templates, videos } from "@/db/schema";
import { encryptSecret } from "@/lib/crypto";
import { LANGUAGE_OPTIONS } from "@/lib/language";
import { catalogKeyword, misspellings } from "@/lib/keyword-catalog";
import { templateProblems, TEMPLATE_PROBLEM_TEXT } from "@/lib/templates";
import { isOwnHost, OWN_HOST_ERROR, ownHosts } from "./own-hosts";

// Campaign, template and AI settings management for the signed-in account.
// Every query is scoped by account id.

export type Result = { ok: true } | { ok: false; error: string };


function splitList(value: string): string[] {
  return [...new Set(value.split(/[,\n]/).map((v) => v.trim()).filter(Boolean))];
}

// Accepts video ids or any YouTube watch, share or Shorts URL.
export function parseVideoIds(value: string): string[] | null {
  const ids: string[] = [];
  for (const item of value.split(/[\s,]+/).filter(Boolean)) {
    const match = /(?:v=|youtu\.be\/|shorts\/|live\/)([A-Za-z0-9_-]{11})/.exec(item) ?? /^([A-Za-z0-9_-]{11})$/.exec(item);
    if (!match) return null;
    ids.push(match[1]!);
  }
  return ids;
}

function validUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

// Two video scopes overlap when either is all videos (null) or they share one.
export function overlaps(a: string[] | null, b: string[] | null): boolean {
  if (a === null || b === null) return true;
  const set = new Set(a);
  return b.some((id) => set.has(id));
}

export interface CampaignInput {
  channelId: string;
  name: string;
  keyword: string;
  aliases: string;
  intent: string;
  destinationUrl: string;
  // Pasted video links or ids (optional when `videoIds` has picks).
  videos: string;
  // Videos ticked in the picker (Phase 14). At least one video is required:
  // new rules are never channel-wide.
  videoIds?: string[];
  // "All my videos": channel-wide, new uploads included.
  allVideos?: boolean;
}

export async function createCampaign(db: Db, accountId: string, input: CampaignInput): Promise<Result> {
  // Keywords come from the catalog, which also sets the lead temperature
  // (Phase 14). Own keywords are not offered yet.
  const picked = catalogKeyword(input.keyword);
  if (!picked) return { ok: false, error: "Pick a keyword from the list." };
  const keyword = picked.keyword;
  const intent: Intent = picked.temperature;
  if (!validUrl(input.destinationUrl.trim())) return { ok: false, error: "Enter the full address of your opt-in page (https://...)." };
  if (isOwnHost(input.destinationUrl.trim(), await ownHosts(db, accountId))) return { ok: false, error: OWN_HOST_ERROR };
  const pasted = input.videos.trim() ? parseVideoIds(input.videos) : [];
  if (pasted === null) return { ok: false, error: "Some video links were not recognized." };
  const ticked = (input.videoIds ?? []).filter((id) => /^[A-Za-z0-9_-]{11}$/.test(id));
  const videoIds = input.allVideos ? null : [...new Set([...ticked, ...pasted])].slice(0, 200);
  if (videoIds !== null && videoIds.length === 0) return { ok: false, error: "Pick at least one video, or all of them." };
  const [channel] = await db
    .select({ id: channels.id })
    .from(channels)
    .where(and(eq(channels.id, input.channelId), eq(channels.accountId, accountId), eq(channels.status, "connected")));
  if (!channel) return { ok: false, error: "Connect your channel first." };
  // One rule per keyword and video (review finding 14): a second GUIDE rule
  // on a video already watched for GUIDE would split the numbers and confuse.
  const sameKeyword = await db
    .select({ videoIds: campaigns.videoIds, active: campaigns.active })
    .from(campaigns)
    .where(and(eq(campaigns.channelId, channel.id), sql`upper(${campaigns.keyword}) = ${keyword}`));
  const clash = sameKeyword.find((rule) => overlaps(rule.videoIds, videoIds));
  if (clash) {
    return {
      ok: false,
      error: `${keyword} is already watched on ${clash.videoIds === null || videoIds === null ? "these videos" : "some of these videos"}${clash.active ? "" : " by a paused automation"}. Resume or delete that automation instead.`,
    };
  }
  await db.insert(campaigns).values({
    accountId,
    channelId: channel.id,
    // What the viewer gets (catalog), used by the AI draft and as the title.
    name: input.name.trim() || picked.gets,
    keyword,
    // Misspellings: as edited in Advanced, else the automatic ones.
    aliases: (input.aliases.trim() ? splitList(input.aliases.toUpperCase()) : misspellings(keyword)).filter((a) => a !== keyword).slice(0, 10),
    intent,
    destinationUrl: input.destinationUrl.trim(),
    videoIds,
  });
  // Poll soon so the creator sees the engine working.
  await db.update(channels).set({ nextPollAt: null }).where(eq(channels.id, channel.id));
  return { ok: true };
}

export async function setCampaignActive(db: Db, accountId: string, campaignId: string, active: boolean): Promise<boolean> {
  const rows = await db
    .update(campaigns)
    .set({ active, updatedAt: new Date() })
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.accountId, accountId)))
    .returning({ id: campaigns.id });
  return rows.length > 0;
}

export async function deleteCampaign(db: Db, accountId: string, campaignId: string): Promise<boolean> {
  const rows = await db
    .delete(campaigns)
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.accountId, accountId)))
    .returning({ id: campaigns.id });
  return rows.length > 0;
}

export async function addTemplate(db: Db, accountId: string, input: { campaignId: string; language: string; body: string }): Promise<Result> {
  const body = input.body.trim();
  const problems = templateProblems(body);
  if (problems.length > 0) return { ok: false, error: TEMPLATE_PROBLEM_TEXT[problems[0]!] };
  if (!LANGUAGE_OPTIONS.includes(input.language)) return { ok: false, error: "Pick a language." };
  const [campaign] = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(and(eq(campaigns.id, input.campaignId), eq(campaigns.accountId, accountId)));
  if (!campaign) return { ok: false, error: "Campaign not found." };
  await db.insert(templates).values({ accountId, campaignId: campaign.id, language: input.language, body });
  return { ok: true };
}

export async function deleteTemplate(db: Db, accountId: string, templateId: string): Promise<boolean> {
  const rows = await db
    .delete(templates)
    .where(and(eq(templates.id, templateId), eq(templates.accountId, accountId)))
    .returning({ id: templates.id });
  return rows.length > 0;
}

export async function setDefaultLanguage(db: Db, accountId: string, channelId: string, language: string): Promise<boolean> {
  if (!LANGUAGE_OPTIONS.includes(language)) return false;
  const rows = await db
    .update(channels)
    .set({ defaultLanguage: language })
    .where(and(eq(channels.id, channelId), eq(channels.accountId, accountId)))
    .returning({ id: channels.id });
  return rows.length > 0;
}

const PROVIDERS: AiProvider[] = ["platform", "gemini", "openai", "anthropic"];

// The own key is stored encrypted and never shown again (Q-13c).
export async function setAiSettings(
  db: Db,
  accountId: string,
  input: { provider: string; apiKey: string; model: string },
  encryptionKey: string | undefined,
): Promise<Result> {
  if (!PROVIDERS.includes(input.provider as AiProvider)) return { ok: false, error: "Pick a provider." };
  const provider = input.provider as AiProvider;
  if (provider === "platform") {
    await db.update(accounts).set({ aiProvider: "platform", aiKeyEnc: null, aiModel: null }).where(eq(accounts.id, accountId));
    return { ok: true };
  }
  const [current] = await db.select({ aiProvider: accounts.aiProvider, aiKeyEnc: accounts.aiKeyEnc }).from(accounts).where(eq(accounts.id, accountId));
  const apiKey = input.apiKey.trim();
  const keepKey = !apiKey && current?.aiProvider === provider && current.aiKeyEnc;
  if (!apiKey && !keepKey) return { ok: false, error: "Paste your API key." };
  if (apiKey && !encryptionKey) return { ok: false, error: "Key storage is not configured." };
  await db
    .update(accounts)
    .set({
      aiProvider: provider,
      aiModel: input.model.trim() || null,
      ...(apiKey ? { aiKeyEnc: encryptSecret(apiKey, encryptionKey!) } : {}),
    })
    .where(eq(accounts.id, accountId));
  return { ok: true };
}

export async function listCampaigns(db: Db, accountId: string) {
  const rows = await db.select().from(campaigns).where(eq(campaigns.accountId, accountId)).orderBy(asc(campaigns.createdAt));
  const tpl = rows.length
    ? await db
        .select()
        .from(templates)
        .where(inArray(templates.campaignId, rows.map((r) => r.id)))
        .orderBy(asc(templates.createdAt))
    : [];
  return rows.map((campaign) => ({ ...campaign, templates: tpl.filter((t) => t.campaignId === campaign.id) }));
}

// Everything the approval queue shows. Comment text and video titles are
// YouTube data, shown while they exist (30-day rule).
export async function queueView(db: Db, accountId: string) {
  const rows = await db
    .select({ reply: replies, comment: comments, videoTitle: videos.title })
    .from(replies)
    .leftJoin(comments, eq(comments.id, replies.commentId))
    .leftJoin(videos, and(eq(videos.channelId, replies.channelId), eq(videos.youtubeVideoId, replies.youtubeVideoId)))
    .where(and(eq(replies.accountId, accountId), inArray(replies.status, ["pending_approval", "approved", "queued", "sending", "sent", "sent_manually", "failed", "skipped"])))
    .orderBy(desc(replies.createdAt))
    .limit(200);
  // Information only, never a block (Q-14): earlier replies to the same
  // person on the same video, within the data we still hold.
  const repliedBefore = new Set(
    rows
      .filter((r) => ["sent", "sent_manually"].includes(r.reply.status) && r.comment?.authorChannelId)
      .map((r) => `${r.comment!.authorChannelId}|${r.reply.youtubeVideoId}`),
  );
  return rows.map((row) => ({
    ...row,
    repliedBefore: Boolean(row.comment?.authorChannelId && repliedBefore.has(`${row.comment.authorChannelId}|${row.reply.youtubeVideoId}`) && !["sent", "sent_manually"].includes(row.reply.status)),
  }));
}
