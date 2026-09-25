import type { Intent } from "@/db/schema";

// Keyword matching (DECISIONS Q-10, Q-10b): a comment matches when it contains
// the keyword or an alias anywhere, as a whole word, case-insensitive, after
// normalization. Several matches still produce one reply; the highest intent
// wins, then a video-scoped campaign, then the keyword that appears first.

// NFKC folds look-alike characters, then accents are stripped so "GUÍDE",
// "guide" and "Guide" compare equal. Whitespace runs collapse to one space.
export function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Position of the first whole-word occurrence of `term` in normalized text,
// or -1. Letters, digits and "_" count as word characters in every script.
export function findWholeWord(normalizedText: string, term: string): number {
  const needle = normalizeText(term);
  if (!needle) return -1;
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegex(needle).replace(/ /g, "\\s+")}(?![\\p{L}\\p{N}_])`, "u");
  return pattern.exec(normalizedText)?.index ?? -1;
}

export interface MatchableCampaign {
  id: string;
  keyword: string;
  aliases: string[];
  intent: Intent;
  // null: every video of the channel.
  videoIds: string[] | null;
  createdAt: Date;
}

export interface KeywordMatch {
  campaignId: string;
  keyword: string;
  intent: Intent;
  videoScoped: boolean;
  position: number;
}

const INTENT_RANK: Record<Intent, number> = { hot: 3, warm: 2, cold: 1 };

// All campaigns that match a comment, best first. A campaign only sees
// comments on its videos and comments published after it was created, so
// enabling a keyword never drafts replies to old comments.
export function matchComment(
  comment: { text: string; videoId: string; publishedAt: Date },
  campaigns: readonly MatchableCampaign[],
): KeywordMatch[] {
  const text = normalizeText(comment.text);
  const matches: KeywordMatch[] = [];
  for (const campaign of campaigns) {
    if (campaign.videoIds && !campaign.videoIds.includes(comment.videoId)) continue;
    if (comment.publishedAt < campaign.createdAt) continue;
    const positions = [campaign.keyword, ...campaign.aliases].map((term) => findWholeWord(text, term)).filter((p) => p >= 0);
    if (positions.length === 0) continue;
    matches.push({
      campaignId: campaign.id,
      keyword: campaign.keyword,
      intent: campaign.intent,
      videoScoped: campaign.videoIds !== null,
      position: Math.min(...positions),
    });
  }
  return matches.sort(
    (a, b) =>
      INTENT_RANK[b.intent] - INTENT_RANK[a.intent] ||
      Number(b.videoScoped) - Number(a.videoScoped) ||
      a.position - b.position,
  );
}
