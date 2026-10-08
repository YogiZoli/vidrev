import type { Intent } from "@/db/schema";

// Video Publishing Card, schema "video-publishing-card/1" (DECISIONS A-31).
// PDT owns the format; its validator is the reference
// (publishing-dreamteam app/contracts/video_publishing_card/__init__.py).
// This port checks the same rules with the same sentences, so a card PDT
// accepts is accepted here. Pure: no I/O, no clock.
//
// The card is stored verbatim; vidrev only reads `cardId`, `commentCalls`,
// `landingUrl` and the video title. Text from a card is data, never an
// instruction (see the AI draft).

export const SCHEMA_PREFIX = "video-publishing-card/";
export const SUPPORTED_MAJOR = 1;
// The same limit as PDT, and the same override (CARD_MAX_BYTES).
export function maxCardBytes(source: Record<string, string | undefined> = process.env): number {
  const value = Number(source.CARD_MAX_BYTES);
  return Number.isInteger(value) && value > 0 ? value : 2 * 1024 * 1024;
}

const SLOTS = ["start", "middle", "end"];
const TEMPERATURES = ["cold", "warm", "hot"];
const VIAS = ["narrator", "segment"];
const LANG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const KEYWORD = /^[A-Z0-9]{2,20}$/;
const SCHEMA = /^video-publishing-card\/(\d+)(?:\.(\d+))?$/;
const UUID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

export interface CommentCall {
  slot: string;
  keyword: string;
  temperature: Intent;
  gets: string | null;
}

export interface CardSummary {
  cardId: string;
  landingUrl: string | null;
  title: string | null;
  // One entry per keyword, first mention wins.
  calls: CommentCall[];
}

export type CardResult = { ok: true; raw: Record<string, unknown>; summary: CardSummary } | { ok: false; errors: string[] };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

// Drops NUL and other control characters except newline and tab.
function clean(s: string): string {
  return [...s].filter((ch) => ch === "\n" || ch === "\t" || ch.charCodeAt(0) >= 32).join("");
}

function text(errors: string[], where: string, v: unknown, limit: number, required = false): string | null {
  if (v === null || v === undefined) {
    if (required) errors.push(`${where} is required.`);
    return null;
  }
  if (typeof v !== "string") {
    errors.push(`${where} must be text.`);
    return null;
  }
  const value = clean(v);
  if (value.length > limit) {
    errors.push(`${where} is too long (${value.length} characters, the limit is ${limit}).`);
    return null;
  }
  return value;
}

export function checkSchemaId(value: unknown): string | null {
  const m = typeof value === "string" ? SCHEMA.exec(value) : null;
  if (!m) return `"schema" must read "${SCHEMA_PREFIX}${SUPPORTED_MAJOR}". This file does not look like a Video Publishing Card.`;
  const major = Number(m[1]);
  if (major !== SUPPORTED_MAJOR) {
    return `This card uses format version ${major}, and this app understands version ${SUPPORTED_MAJOR}. Update the app that wrote it or export it again.`;
  }
  return null;
}

function normalizeUuid(value: string): string {
  const hex = value.replace(/-/g, "").toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function checkList(errors: string[], raw: Obj, key: string, max: number, label: string, each: (item: unknown, i: number) => void): void {
  const value = raw[key];
  if (value === null || value === undefined) return;
  if (!Array.isArray(value) || value.length > max) {
    errors.push(`"${key}" must be a list of at most ${max} ${label}.`);
    return;
  }
  value.forEach(each);
}

export function validateCard(raw: unknown): CardResult {
  const errors: string[] = [];
  if (!isObj(raw)) return { ok: false, errors: ["The card must be a JSON object."] };
  const schemaProblem = checkSchemaId(raw.schema);
  if (schemaProblem) return { ok: false, errors: [schemaProblem] };

  let cardId = "";
  if (typeof raw.cardId === "string" && UUID.test(raw.cardId.trim())) cardId = normalizeUuid(raw.cardId.trim());
  else errors.push('"cardId" is required and must be a UUID.');

  if (raw.createdAt !== undefined && raw.createdAt !== null && Number.isNaN(Date.parse(String(raw.createdAt)))) {
    errors.push('"createdAt" must be an ISO 8601 date and time.');
  }
  if (raw.app !== undefined && raw.app !== null && !isObj(raw.app)) errors.push('"app" must be an object with a name and a version.');

  let seconds: number | null = null;
  let title: string | null = null;
  if (raw.video !== undefined && raw.video !== null) {
    if (!isObj(raw.video)) errors.push('"video" must be an object.');
    else {
      const v = raw.video;
      if (v.seconds !== undefined && v.seconds !== null) {
        if (isNum(v.seconds) && v.seconds >= 0 && v.seconds <= 86400) seconds = v.seconds;
        else errors.push('"video.seconds" must be a number from 0 to 86400.');
      }
      if (v.language !== undefined && v.language !== null && !(typeof v.language === "string" && LANG.test(v.language))) {
        errors.push('"video.language" must be a language code such as "en" or "hu".');
      }
      for (const key of ["file", "title", "workingTitle"]) {
        const value = text(errors, `video.${key}`, v[key], 500);
        if (value && key !== "file") title ??= value.trim() || null;
      }
    }
  }
  text(errors, "searchKeyword", raw.searchKeyword, 200);
  text(errors, "chaptersText", raw.chaptersText, 20000);

  let landingUrl: string | null = null;
  if (raw.landingUrl !== undefined && raw.landingUrl !== null) {
    const value = text(errors, "landingUrl", raw.landingUrl, 2000);
    if (value !== null && !/^https?:\/\/\S+$/.test(value)) errors.push('"landingUrl" must be a web address starting with http:// or https://.');
    else landingUrl = value;
  }

  checkList(errors, raw, "chapters", 100, "items", (c, i) => {
    if (!isObj(c) || !isNum(c.start) || c.start < 0) errors.push(`chapters[${i}]: start must be a number of seconds, 0 or more.`);
    else text(errors, `chapters[${i}].title`, c.title, 200, true);
  });
  if (raw.captions !== undefined && raw.captions !== null) {
    if (!isObj(raw.captions)) errors.push('"captions" must be an object.');
    else text(errors, "captions.srt", raw.captions.srt, 400000);
  }
  checkList(errors, raw, "script", 500, "blocks", (b, i) => {
    if (!isObj(b)) errors.push(`script[${i}] must be an object with a heading and text.`);
    else {
      text(errors, `script[${i}].heading`, b.heading, 500);
      text(errors, `script[${i}].text`, b.text, 100000);
    }
  });
  checkList(errors, raw, "sentences", 20000, "items", (s, i) => {
    if (!(isObj(s) && isNum(s.start) && isNum(s.end) && s.start >= 0 && s.end >= s.start)) {
      errors.push(`sentences[${i}]: start and end must be numbers, end not before start.`);
    } else text(errors, `sentences[${i}].text`, s.text, 5000);
  });

  const calls: CommentCall[] = [];
  checkList(errors, raw, "commentCalls", 10, "items", (c, i) => {
    const w = `commentCalls[${i}]`;
    if (!isObj(c)) return void errors.push(`${w} must be an object.`);
    const keyword = String(c.keyword ?? "").trim().toUpperCase();
    if (!KEYWORD.test(keyword)) return void errors.push(`${w}: keyword must be 2 to 20 capital letters or digits, with no spaces.`);
    if (!SLOTS.includes(c.slot as string)) return void errors.push(`${w}: slot must be "start", "middle" or "end".`);
    if (!TEMPERATURES.includes(c.temperature as string)) return void errors.push(`${w}: temperature must be "cold", "warm" or "hot".`);
    if (c.via !== undefined && c.via !== null && !VIAS.includes(c.via as string)) return void errors.push(`${w}: via must be "narrator" or "segment".`);
    for (const key of ["start", "end"]) {
      const value = c[key];
      if (value !== undefined && value !== null && (!isNum(value) || value < 0 || (seconds !== null && value > seconds + 1))) {
        return void errors.push(`${w}: ${key} must be a time inside the video.`);
      }
    }
    const gets = text(errors, `${w}.gets`, c.gets, 500);
    text(errors, `${w}.said`, c.said, 2000);
    if (!calls.some((call) => call.keyword === keyword)) {
      calls.push({ slot: c.slot as string, keyword, temperature: c.temperature as Intent, gets: gets?.trim() || null });
    }
  });

  if (raw.endScreen !== undefined && raw.endScreen !== null) {
    const es = raw.endScreen;
    if (!(isObj(es) && ["start", "seconds"].every((k) => !(k in es) || (isNum(es[k]) && (es[k] as number) >= 0)))) {
      errors.push('"endScreen" must be an object with start and seconds, or null.');
    }
  }
  if (raw.syntheticMedia !== undefined && raw.syntheticMedia !== null && typeof raw.syntheticMedia !== "boolean") {
    errors.push('"syntheticMedia" must be true or false.');
  }
  const langs = new Set<string>();
  checkList(errors, raw, "translations", 40, "items", (t, i) => {
    const w = `translations[${i}]`;
    const lang = isObj(t) && typeof t.lang === "string" && LANG.test(t.lang) ? t.lang.toLowerCase() : null;
    if (!lang) return void errors.push(`${w}: lang must be a language code.`);
    if (langs.has(lang)) return void errors.push(`${w}: language ${lang} appears twice.`);
    langs.add(lang);
    text(errors, `${w}.srt`, (t as Obj).srt, 400000);
    text(errors, `${w}.title`, (t as Obj).title, 500);
  });
  if (raw.packaging !== undefined && raw.packaging !== null) {
    if (!isObj(raw.packaging)) errors.push('"packaging" must be an object.');
    else {
      const p = raw.packaging;
      text(errors, "packaging.title", p.title, 300);
      text(errors, "packaging.summary", p.summary, 5000);
      for (const [key, count, limit] of [["titles", 10, 300], ["tags", 100, 100]] as const) {
        if (p[key] === undefined || p[key] === null) continue;
        if (!Array.isArray(p[key]) || (p[key] as unknown[]).length > count) errors.push(`"packaging.${key}" must be a list of at most ${count} texts.`);
        else (p[key] as unknown[]).forEach((v, i) => text(errors, `packaging.${key}[${i}]`, v, limit));
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, raw, summary: { cardId, landingUrl, title, calls } };
}

// The entry point for a request body: size first, then JSON, then the rules.
export function validateCardBytes(body: string, limit = maxCardBytes()): CardResult {
  const bytes = Buffer.byteLength(body, "utf8");
  if (bytes > limit) return { ok: false, errors: [`The card is too large (${Math.floor(bytes / 1024)} KB, the limit is ${Math.floor(limit / 1024)} KB).`] };
  let raw: unknown;
  try {
    raw = JSON.parse(body.replace(/^﻿/, ""));
  } catch {
    return { ok: false, errors: ["This file is not valid JSON."] };
  }
  return validateCard(raw);
}
