import type { CommentAnalysis, Tally } from "./comments";
import type { Detection, Segment } from "./stack";

// The stored result of one audit (DECISIONS P9-07). Counts and derived
// numbers only: comment text is never stored, and the pointers, titles and
// links that come from the YouTube API live in AuditExamples, which is wiped
// after 30 days.

export const RESULT_VERSION = 1;

export interface ScoreFactor {
  id: "questions_answered" | "buying_answered" | "link_coverage" | "links_measured";
  label: string;
  weight: number;
  // null when there was too little data to judge this factor.
  ratio: number | null;
  detail: string;
}

export interface Finding {
  id: "no_comments" | "unanswered_buying" | "unanswered_questions" | "unmeasured_links" | "no_link_videos" | "keyword_candidate" | "stack" | "all_answered";
  strength: number;
  text: string;
}

export interface LinkSummary {
  videosChecked: number;
  videosWithLink: number;
  linksFound: number;
  linksChecked: number;
  measured: number;
  ownDomain: number;
}

export interface AuditResult {
  version: number;
  sample: { videos: number; comments: number; commentsOffVideos: number };
  questions: Tally;
  buying: Tally;
  keywords: { word: string; comments: number }[];
  links: LinkSummary;
  stack: { segment: Segment; detected: Pick<Detection, "id" | "label" | "category">[] };
  score: { value: number | null; factors: ScoreFactor[] };
  findings: Finding[];
}

// API-derived material for the full report; scrubbed at 30 days.
export interface AuditExamples {
  channelTitle: string | null;
  videos: { id: string; title: string }[];
  questions: CommentAnalysis["questionExamples"];
  buying: CommentAnalysis["buyingExamples"];
  links: { url: string; finalHost: string | null; measured: "utm" | "click_tracker" | null; ownDomain: boolean; stacks: string[] }[];
}
