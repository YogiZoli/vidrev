// Reply templates and drafts. Bodies keep a {link} placeholder that is filled
// in at send time (Phase 5 swaps the destination URL for the tracked link).
export const LINK_PLACEHOLDER = "{link}";
export const MAX_REPLY_LENGTH = 1000;

// Replies must never ask for a like, subscribe or similar engagement as a
// condition (brief, YouTube compliance). Checked on every template save and
// on every draft, AI or not.
const ENGAGEMENT_BAIT = [
  /\bsubscrib\w*/iu,
  /\blike (this|the|my) (video|comment)\b/iu,
  /\bhit (the )?like\b/iu,
  /\bsmash (that|the) like\b/iu,
  /\bturn on (the )?(notifications?|bell)\b/iu,
  /\bfeliratkoz\w*/iu,
  /\blájkol\w*/iu,
  /\bsuscr[ií]b\w*/iu,
  /\babonn\w*/iu,
];

export type TemplateProblem = "empty" | "too_long" | "missing_link" | "several_links" | "engagement_bait";

export function templateProblems(body: string): TemplateProblem[] {
  const text = body.trim();
  if (!text) return ["empty"];
  const problems: TemplateProblem[] = [];
  if (text.length > MAX_REPLY_LENGTH) problems.push("too_long");
  const links = text.split(LINK_PLACEHOLDER).length - 1;
  if (links === 0) problems.push("missing_link");
  if (links > 1) problems.push("several_links");
  if (ENGAGEMENT_BAIT.some((pattern) => pattern.test(text))) problems.push("engagement_bait");
  return problems;
}

export const TEMPLATE_PROBLEM_TEXT: Record<TemplateProblem, string> = {
  empty: "The reply is empty.",
  too_long: `The reply is longer than ${MAX_REPLY_LENGTH} characters.`,
  missing_link: `The reply needs the ${LINK_PLACEHOLDER} placeholder exactly once.`,
  several_links: `Use the ${LINK_PLACEHOLDER} placeholder only once.`,
  engagement_bait: "Replies must not ask for likes, subscriptions or notifications.",
};

export function renderReply(body: string, link: string): string {
  return body.replace(LINK_PLACEHOLDER, link);
}
