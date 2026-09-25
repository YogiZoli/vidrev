import { franc } from "franc-min";

// Reply language cascade (B-06): the commenter's language only when an
// approved template exists in it, else the channel's default language when a
// template exists in it, else English. Never an unapproved translation.

// franc returns ISO 639-3; templates use ISO 639-1.
const ISO3_TO_1: Record<string, string> = {
  eng: "en", spa: "es", por: "pt", fra: "fr", deu: "de", ita: "it", nld: "nl", hun: "hu", pol: "pl",
  ces: "cs", slk: "sk", ron: "ro", bul: "bg", hrv: "hr", srp: "sr", slv: "sl", ukr: "uk", rus: "ru",
  tur: "tr", ell: "el", swe: "sv", dan: "da", nob: "no", fin: "fi", ind: "id", zlm: "ms", tgl: "tl",
  vie: "vi", tha: "th", hin: "hi", ben: "bn", urd: "ur", arb: "ar", pes: "fa", heb: "he", cmn: "zh",
  jpn: "ja", kor: "ko", swh: "sw", afr: "af",
};

// Short comments ("guide pls") are too short to detect reliably.
const MIN_DETECT_LENGTH = 20;

export function detectLanguage(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length < MIN_DETECT_LENGTH) return null;
  return ISO3_TO_1[franc(trimmed, { minLength: MIN_DETECT_LENGTH })] ?? null;
}

export function pickReplyLanguage(input: {
  commentLanguage: string | null;
  channelDefault: string;
  templateLanguages: readonly string[];
}): string {
  const available = new Set(input.templateLanguages);
  if (input.commentLanguage && available.has(input.commentLanguage)) return input.commentLanguage;
  if (available.has(input.channelDefault)) return input.channelDefault;
  if (available.has("en")) return "en";
  // No template in any preferred language: the creator's default still
  // decides, the AI draft is written in it and the creator approves it.
  return input.channelDefault;
}

// Languages offered in the UI for templates and the channel default.
export const LANGUAGE_OPTIONS = [...new Set(Object.values(ISO3_TO_1))].sort();
