import type { CommentAnalysis } from "./comments";
import { type AuditResult, type Finding, type LinkSummary, RESULT_VERSION, type ScoreFactor } from "./result";
import type { Detection } from "./stack";
import { segmentOf } from "./stack";

// Comment Conversion Score, 0 to 100 (DECISIONS P9-08). Four factors, each a
// real ratio from what was measured; a factor with too little data is left
// out and the rest are re-weighted. Fewer than two scored factors: no score.

const MIN_SCORED_WEIGHT = 40;

export function scoreFactors(analysis: CommentAnalysis, links: LinkSummary): ScoreFactor[] {
  const q = analysis.questions;
  const b = analysis.buying;
  const qKnown = q.answered + q.unanswered;
  const bKnown = b.answered + b.unanswered;
  return [
    {
      id: "questions_answered",
      label: "Questions you answered",
      weight: 30,
      ratio: qKnown >= 3 ? q.answered / qKnown : null,
      detail: qKnown >= 3 ? `${q.answered} of ${qKnown} questions have a reply from you` : "Fewer than 3 questions found",
    },
    {
      id: "buying_answered",
      label: "Buying signals you answered",
      weight: 30,
      ratio: bKnown >= 2 ? b.answered / bKnown : null,
      detail: bKnown >= 2 ? `${b.answered} of ${bKnown} buying-signal comments have a reply from you` : "Fewer than 2 buying-signal comments found",
    },
    {
      id: "link_coverage",
      label: "Videos with a link in the description",
      weight: 20,
      ratio: links.videosChecked >= 1 ? links.videosWithLink / links.videosChecked : null,
      detail: links.videosChecked >= 1 ? `${links.videosWithLink} of ${links.videosChecked} videos` : "No videos checked",
    },
    {
      id: "links_measured",
      label: "Description links that are measured",
      weight: 20,
      ratio: links.linksFound >= 1 ? links.measured / links.linksFound : null,
      detail: links.linksFound >= 1 ? `${links.measured} of ${links.linksFound} links` : "No links found",
    },
  ];
}

export function scoreValue(factors: readonly ScoreFactor[]): number | null {
  const scored = factors.filter((f) => f.ratio !== null);
  const weight = scored.reduce((sum, f) => sum + f.weight, 0);
  if (weight < MIN_SCORED_WEIGHT) return null;
  const total = scored.reduce((sum, f) => sum + f.weight * (f.ratio ?? 0), 0);
  return Math.round((total / weight) * 100);
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// Every finding that holds for this channel, strongest first. The instant
// preview shows the first three; the email shows all of them.
export function buildFindings(input: {
  analysis: CommentAnalysis;
  links: LinkSummary;
  detected: readonly Detection[];
  videos: number;
  commentsOffVideos: number;
}): Finding[] {
  const { analysis, links, detected, videos } = input;
  const findings: Finding[] = [];

  if (videos > 0 && analysis.comments === 0) {
    findings.push({
      id: "no_comments",
      strength: 200,
      text:
        input.commentsOffVideos >= videos
          ? `Comments are turned off on your last ${plural(videos, "video", "videos")}, so there is nothing to convert yet.`
          : `We found no public comments on your last ${plural(videos, "video", "videos")}.`,
    });
  }
  const b = analysis.buying;
  if (b.unanswered > 0) {
    findings.push({
      id: "unanswered_buying",
      strength: 100 + Math.min(b.unanswered, 50),
      text: `${plural(b.unanswered, "comment looks", "comments look")} like ${b.unanswered === 1 ? "a buying signal" : "buying signals"} (price, link, how to join) and ${b.unanswered === 1 ? "has" : "have"} no reply from you.`,
    });
  }
  if (links.linksFound > 0 && links.measured === 0) {
    findings.push({
      id: "unmeasured_links",
      strength: 90,
      text: `None of the ${plural(links.linksFound, "link", "links")} in your descriptions is measured, so you cannot tell which video brought a click.`,
    });
  }
  const q = analysis.questions;
  if (q.unanswered > 0) {
    findings.push({
      id: "unanswered_questions",
      strength: 50 + Math.min(q.unanswered, 50),
      text: `${q.unanswered} of ${plural(q.answered + q.unanswered, "question", "questions")} on your last ${plural(videos, "video", "videos")} ${q.unanswered === 1 ? "has" : "have"} no reply from you.`,
    });
  }
  const without = links.videosChecked - links.videosWithLink;
  if (links.videosChecked > 0 && without > 0) {
    findings.push({
      id: "no_link_videos",
      strength: 60 + without * 5,
      text: `${without} of your last ${plural(links.videosChecked, "video", "videos")} ${without === 1 ? "has" : "have"} no link in the description.`,
    });
  }
  const keyword = analysis.keywords[0];
  if (keyword) {
    findings.push({
      id: "keyword_candidate",
      strength: 40 + keyword.comments,
      text: `"${keyword.word}" appears in ${keyword.comments} different comments: a candidate keyword for a comment call to action.`,
    });
  }
  const stack = detected.find((d) => d.category !== "affiliate" && d.category !== "scheduling") ?? detected[0];
  if (stack) {
    findings.push({
      id: "stack",
      strength: stack.id === "ghl" ? 55 : 35,
      text: `Your description links lead to a page running on ${stack.label}.`,
    });
  }
  if (findings.length === 0 && analysis.questions.total + analysis.buying.total > 0) {
    findings.push({ id: "all_answered", strength: 20, text: "Every question and buying signal we found has a reply from you." });
  }
  return findings.sort((a, b2) => b2.strength - a.strength || a.id.localeCompare(b2.id));
}

export const PREVIEW_FINDINGS = 3;

export function buildResult(input: {
  analysis: CommentAnalysis;
  links: LinkSummary;
  detected: readonly Detection[];
  videos: number;
  commentsOffVideos: number;
}): AuditResult {
  const factors = scoreFactors(input.analysis, input.links);
  return {
    version: RESULT_VERSION,
    sample: { videos: input.videos, comments: input.analysis.comments, commentsOffVideos: input.commentsOffVideos },
    questions: input.analysis.questions,
    buying: input.analysis.buying,
    keywords: input.analysis.keywords,
    links: input.links,
    stack: {
      segment: segmentOf(input.detected, input.links.linksChecked),
      detected: input.detected.map((d) => ({ id: d.id, label: d.label, category: d.category })),
    },
    score: { value: scoreValue(factors), factors },
    findings: buildFindings(input),
  };
}
