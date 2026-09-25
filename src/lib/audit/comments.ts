import { normalizeText } from "@/lib/keywords";

// Rule-based comment classification for Audit my channel (DECISIONS P9-04,
// SPEC-REVIEW Q-18): no LLM, the same result every time, English patterns.
// Comment text lives only in worker memory while it is analysed; it is never
// stored (P9-07).

export interface AuditThread {
  videoId: string;
  commentId: string;
  text: string;
  authorChannelId: string | null;
  totalReplyCount: number;
  // Authors of the replies YouTube included with the thread (at most 5).
  replyAuthorIds: string[];
}

export type ReplyState = "answered" | "unanswered" | "unknown";

export interface Tally {
  total: number;
  answered: number;
  unanswered: number;
  // The thread has more replies than YouTube returned and none of the returned
  // ones is the creator's: not counted as unanswered (real numbers only).
  unknown: number;
}

export interface CommentPointer {
  videoId: string;
  commentId: string;
}

export interface CommentAnalysis {
  comments: number;
  questions: Tally;
  buying: Tally;
  keywords: { word: string; comments: number }[];
  questionExamples: CommentPointer[];
  buyingExamples: CommentPointer[];
}

const QUESTION_WORDS = /^(how|what|whats|where|when|why|which|who|can|could|do|does|did|is|are|will|would|should|any)\b/;

export function isQuestion(text: string): boolean {
  if (/[?？]/.test(text)) return true;
  const normalized = normalizeText(text).replace(/^[^a-z0-9]+/, "");
  return QUESTION_WORDS.test(normalized) && normalized.split(" ").length >= 5;
}

const BUYING_PATTERNS: RegExp[] = [
  /\b(how much|price|prices|pricing|cost|costs|fee|fees)\b/,
  /\bhow (do|can|could) (i|we) (buy|get|join|sign up|order|enroll|enrol|apply|book|work with you)\b/,
  /\bwhere (can|do|could) (i|we) (buy|get|find|sign up|join|download|order|book)\b/,
  /\bwhere (to|do i) (buy|get|join|sign up|download)\b/,
  /\b(link|links|website|site) (to|for|please|pls|plz)\b/,
  /\b(please|pls|plz|drop|share|need|send|post|where'?s|wheres|where is|what'?s|whats) (me |us )?(the |a |your )?(link|links)\b/,
  /\b(send|dm|email) me\b/,
  /\bi (want|need|would like|wanna|d like) (to )?(buy|join|get|try|hire|book|order|sign up|enroll|enrol|work with)\b/,
  /\b(i'?m|i am|we'?re|we are) (very |really |so )?interested\b/,
  /\binterested in (your|the|this|buying|joining|working)\b/,
  /\bsign me up\b/,
  /\btake my money\b/,
  /\b(discount|coupon|promo code|voucher|free trial|free download|free template|free guide)\b/,
  /\bworth (it|buying|the money|paying)\b/,
  /\bdo you (offer|sell|have|do|provide) (a |an |any )?(course|courses|program|programme|coaching|template|templates|guide|ebook|e-book|service|services|consulting|mentoring|masterclass)\b/,
  /\b(book|schedule) a (call|demo|session|consultation)\b/,
  /\b(hire|work with) (you|your team)\b/,
  /\b(course|coaching|program|programme|masterclass|membership) (link|details|info|price)\b/,
];

export function isBuyingIntent(text: string): boolean {
  const normalized = normalizeText(text).replace(/[’‘]/g, "'");
  return BUYING_PATTERNS.some((pattern) => pattern.test(normalized));
}

function replyState(thread: AuditThread, creatorChannelId: string): ReplyState {
  if (thread.replyAuthorIds.includes(creatorChannelId)) return "answered";
  if (thread.totalReplyCount === 0) return "unanswered";
  // Every reply was returned and none is the creator's.
  if (thread.replyAuthorIds.length >= thread.totalReplyCount) return "unanswered";
  return "unknown";
}

function emptyTally(): Tally {
  return { total: 0, answered: 0, unanswered: 0, unknown: 0 };
}

function count(tally: Tally, state: ReplyState): void {
  tally.total += 1;
  tally[state] += 1;
}

// Words that are common in every comment section: they carry no signal about
// what viewers want to be sent.
const STOP_WORDS = new Set(
  (
    "the and for that this with you your are was were have has had not but all can will just from they them their there what when where which who how why " +
    "its it's i'm i've i'll dont don't didnt doesn't cant can't wont won't would could should about into than then also more most much many some any " +
    "very really been being out one two get got getting make made like love loved great good best nice awesome amazing thanks thank video videos channel " +
    "content watch watching watched subscribe subscribed comment comments please pls plz yes yeah lol man guys guy bro hey hello hi wow much still even " +
    "only well way time thing things going want need know see use using look looking said say says come came here every ever never always because while " +
    "after before over such too same other another really actually literally definitely first new old big little sir mam"
  ).split(" "),
);

const TOKEN = /[\p{L}\p{N}]+(?:'[\p{L}]+)?/gu;

function tokens(text: string): Set<string> {
  const found = new Set<string>();
  for (const match of normalizeText(text).replace(/[’‘]/g, "'").matchAll(TOKEN)) {
    const word = match[0];
    if (word.length < 3 || word.length > 20 || /^\d+$/.test(word) || STOP_WORDS.has(word)) continue;
    found.add(word);
  }
  return found;
}

const EXAMPLE_LIMIT = 5;

// `threads` are top-level comments of the last videos. The creator's own
// comments are left out.
export function analyzeComments(threads: readonly AuditThread[], creatorChannelId: string): CommentAnalysis {
  const questions = emptyTally();
  const buying = emptyTally();
  const questionExamples: CommentPointer[] = [];
  const buyingExamples: CommentPointer[] = [];
  const perWord = new Map<string, number>();
  let comments = 0;

  for (const thread of threads) {
    if (thread.authorChannelId === creatorChannelId) continue;
    comments += 1;
    const state = replyState(thread, creatorChannelId);
    if (isQuestion(thread.text)) {
      count(questions, state);
      if (state === "unanswered" && questionExamples.length < EXAMPLE_LIMIT) questionExamples.push({ videoId: thread.videoId, commentId: thread.commentId });
    }
    if (isBuyingIntent(thread.text)) {
      count(buying, state);
      if (state === "unanswered" && buyingExamples.length < EXAMPLE_LIMIT) buyingExamples.push({ videoId: thread.videoId, commentId: thread.commentId });
    }
    for (const word of tokens(thread.text)) perWord.set(word, (perWord.get(word) ?? 0) + 1);
  }

  const minimum = comments >= 40 ? 3 : 2;
  const keywords = [...perWord.entries()]
    .filter(([, n]) => n >= minimum)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([word, n]) => ({ word, comments: n }));

  return { comments, questions, buying, keywords, questionExamples, buyingExamples };
}
