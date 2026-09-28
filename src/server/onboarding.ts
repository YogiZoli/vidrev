import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { accounts, channels, integrations } from "@/db/schema";

// Onboarding (Phase 14): an account that cannot turn a comment into a lead
// and a sale spends no polling, no AI drafts and no quota. Each step blocks
// the next: YouTube channel, CRM (GoHighLevel), purchase source, target URL.
export const ONBOARDING_STEPS = ["youtube", "crm", "purchases", "target"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export interface OnboardingState {
  done: Record<OnboardingStep, boolean>;
  // The first step that is not done; null once every step is.
  current: OnboardingStep | null;
  // The channel is being resolved by the worker right now.
  channelConnecting: boolean;
  ghlActive: boolean;
  stripeActive: boolean;
  purchaseSource: "ghl" | "stripe" | null;
  defaultTargetUrl: string | null;
}

export async function onboardingState(db: Db, accountId: string): Promise<OnboardingState> {
  const [account] = await db
    .select({ purchaseSource: accounts.purchaseSource, defaultTargetUrl: accounts.defaultTargetUrl })
    .from(accounts)
    .where(eq(accounts.id, accountId));
  const channelRows = await db
    .select({ status: channels.status })
    .from(channels)
    .where(and(eq(channels.accountId, accountId), inArray(channels.status, ["connecting", "connected"])));
  const integrationRows = await db
    .select({ type: integrations.type, status: integrations.status })
    .from(integrations)
    .where(and(eq(integrations.accountId, accountId), inArray(integrations.type, ["ghl", "stripe"]), eq(integrations.status, "active")));
  const ghlActive = integrationRows.some((r) => r.type === "ghl");
  const stripeActive = integrationRows.some((r) => r.type === "stripe");
  const purchaseSource = account?.purchaseSource ?? null;
  const defaultTargetUrl = account?.defaultTargetUrl ?? null;

  const youtube = channelRows.some((r) => r.status === "connected");
  const crm = youtube && ghlActive;
  const purchases = crm && ((purchaseSource === "ghl" && ghlActive) || (purchaseSource === "stripe" && stripeActive));
  const target = purchases && Boolean(defaultTargetUrl);
  const done = { youtube, crm, purchases, target };
  return {
    done,
    current: ONBOARDING_STEPS.find((step) => !done[step]) ?? null,
    channelConnecting: channelRows.some((r) => r.status === "connecting"),
    ghlActive,
    stripeActive,
    purchaseSource,
    defaultTargetUrl,
  };
}

// Stamps `onboarded_at` once every step is done. Returns whether the account
// is onboarded now. Once stamped it stays: a later disconnect shows up in
// Settings, it does not lock the app again.
export async function completeOnboardingIfReady(db: Db, accountId: string, now = new Date()): Promise<boolean> {
  const state = await onboardingState(db, accountId);
  if (state.current !== null) return false;
  await db.update(accounts).set({ onboardedAt: now }).where(and(eq(accounts.id, accountId), isNull(accounts.onboardedAt)));
  return true;
}

// A target URL the creator types: https (or http) with a real host.
export function parseTargetUrl(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!url.hostname.includes(".")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

// Where a connect flow returns: the onboarding page while the account is not
// onboarded (query kept, so its notice shows there), else the given page.
export function returnPath(account: { onboardedAt: Date | null }, path: string): string {
  if (account.onboardedAt) return path;
  const query = path.includes("?") ? path.slice(path.indexOf("?")) : "";
  return `/onboarding${query}`;
}
