import type { Intent } from "@/db/schema";

// The keywords a creator picks from (Phase 14). Each carries its lead
// temperature: what a viewer who comments it is ready for. Stored as the
// campaign's `intent`; the UI calls it lead temperature.
export interface CatalogKeyword {
  keyword: string;
  temperature: Intent;
  gets: string;
}

export const KEYWORD_CATALOG: CatalogKeyword[] = [
  { keyword: "GUIDE", temperature: "cold", gets: "a free guide" },
  { keyword: "CHECKLIST", temperature: "cold", gets: "a checklist" },
  { keyword: "TEMPLATE", temperature: "cold", gets: "a template" },
  { keyword: "FREE", temperature: "cold", gets: "a free resource" },
  { keyword: "TRAINING", temperature: "warm", gets: "a free training" },
  { keyword: "WORKSHOP", temperature: "warm", gets: "a workshop seat" },
  { keyword: "WEBINAR", temperature: "warm", gets: "a webinar seat" },
  { keyword: "COURSE", temperature: "warm", gets: "course details" },
  { keyword: "CALL", temperature: "hot", gets: "a call with you" },
  { keyword: "PRICE", temperature: "hot", gets: "the price" },
  { keyword: "APPLY", temperature: "hot", gets: "an application" },
  { keyword: "DEMO", temperature: "hot", gets: "a demo" },
];

export const DEFAULT_KEYWORD = "GUIDE";

export const TEMPERATURE_LABEL: Record<Intent, string> = { cold: "Cold", warm: "Warm", hot: "Hot" };

export function catalogKeyword(keyword: string): CatalogKeyword | undefined {
  const upper = keyword.trim().toUpperCase();
  return KEYWORD_CATALOG.find((k) => k.keyword === upper);
}

// Likely misspellings of a keyword, matched automatically (GUIDE: GUDIE,
// GIUDE, GUIDES...). Swapped neighbours from 4 letters, one dropped letter
// from 6 (shorter words would collide with real words), and the plural.
// Never another catalog keyword.
export function misspellings(keyword: string, max = 10): string[] {
  const word = keyword.trim().toUpperCase();
  if (!/^[A-Z]{3,}$/.test(word)) return [];
  const out = new Set<string>();
  if (!word.endsWith("S")) out.add(`${word}S`);
  if (word.length >= 4) {
    for (let i = 0; i < word.length - 1; i++) {
      if (word[i] === word[i + 1]) continue;
      out.add(word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2));
    }
  }
  if (word.length >= 6) {
    for (let i = 1; i < word.length; i++) out.add(word.slice(0, i) + word.slice(i + 1));
  }
  const taken = new Set(KEYWORD_CATALOG.map((k) => k.keyword));
  return [...out].filter((v) => v !== word && !taken.has(v)).slice(0, max);
}
