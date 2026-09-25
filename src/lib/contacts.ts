import type { ContactIdentityKind, ContactStage } from "@/db/schema";

// Contact identity rules (DECISIONS section 13, Q-23). Pure helpers; the
// database side is src/server/contacts.ts.

export const STAGE_ORDER: readonly ContactStage[] = ["commenter", "subscriber", "buyer"];

// The stage only moves forward (a refund never turns a buyer back).
export function maxStage(a: ContactStage, b: ContactStage): ContactStage {
  return STAGE_ORDER.indexOf(a) >= STAGE_ORDER.indexOf(b) ? a : b;
}

export interface IdentityKey {
  kind: ContactIdentityKind;
  value: string;
}

export interface KeyInput {
  youtubeChannel?: string | null;
  email?: string | null;
  ghlContact?: string | null;
  stripeCustomer?: string | null;
  // Only when the comment has no author channel id: one Contact per comment.
  commentFallback?: string | null;
}

// Every key an event carries, in a stable order. Emails are trimmed and
// lowercased only: no removal of dots or plus tags, which could merge two
// different people (13.5).
export function identityKeys(input: KeyInput): IdentityKey[] {
  const keys: IdentityKey[] = [];
  const add = (kind: ContactIdentityKind, raw: string | null | undefined, normalise: (v: string) => string = (v) => v.trim()) => {
    const value = raw ? normalise(raw) : "";
    if (value && !keys.some((k) => k.kind === kind && k.value === value)) keys.push({ kind, value });
  };
  add("youtube_channel", input.youtubeChannel);
  add("email", input.email, (v) => v.trim().toLowerCase());
  add("ghl_contact", input.ghlContact);
  add("stripe_customer", input.stripeCustomer);
  // The comment id is a key of last resort: a channel id always wins.
  if (!input.youtubeChannel) add("comment", input.commentFallback);
  return keys;
}

export interface ContactSummary {
  id: string;
  firstSeenAt: Date;
}

// The Contact with the earliest first-seen time survives a merge (M-1); the id
// breaks ties so every worker picks the same winner.
export function pickWinner<T extends ContactSummary>(found: readonly T[]): { winner: T; losers: T[] } {
  const sorted = [...found].sort((a, b) => a.firstSeenAt.getTime() - b.firstSeenAt.getTime() || a.id.localeCompare(b.id));
  return { winner: sorted[0]!, losers: sorted.slice(1) };
}

export function earlier(a: Date | null | undefined, b: Date | null | undefined): Date | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return a.getTime() <= b.getTime() ? a : b;
}

export function later(a: Date | null | undefined, b: Date | null | undefined): Date | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return a.getTime() >= b.getTime() ? a : b;
}

// A commenter reference is confirmed for 30 days (13.9); see the retention job.
export const YOUTUBE_IDENTITY_TTL_MS = 30 * 86_400_000;
