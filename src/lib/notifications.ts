import type { Report } from "./report";

// Retention emails (DECISIONS R-35 items 3 and 4): the weekly "this week your
// comments made", instant milestones, and a value recap before a yearly
// renewal. Pure timing rules; the worker sends (src/worker/notifications.ts).

export const MILESTONES = ["first_click", "first_subscriber", "first_buyer"] as const;
export type Milestone = (typeof MILESTONES)[number];

export interface MilestoneState {
  first_click?: string;
  first_subscriber?: string;
  first_buyer?: string;
  // Renewal date (YYYY-MM-DD) the recap was sent for.
  renewal_recap_for?: string;
}

// Milestones reached in the lifetime report that were not announced yet.
export function newMilestones(allTime: Report, state: MilestoneState): Milestone[] {
  const reached: Record<Milestone, boolean> = {
    first_click: allTime.totals.clicks > 0,
    first_subscriber: allTime.totals.subscribers > 0,
    first_buyer: allTime.totals.buyers > 0,
  };
  return MILESTONES.filter((m) => reached[m] && !state[m]);
}

const WEEKDAY = new Map<string, Intl.DateTimeFormat>();

function localParts(at: Date, timeZone: string): { weekday: string; hour: number } {
  let formatter = WEEKDAY.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "numeric", hourCycle: "h23" });
    WEEKDAY.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(at);
  return { weekday: parts.find((p) => p.type === "weekday")!.value, hour: Number(parts.find((p) => p.type === "hour")!.value) };
}

// Monday from 9:00 in the creator's time zone, at most once in six days.
export function weeklyEmailDue(now: Date, timeZone: string, lastSentAt: Date | null): boolean {
  const { weekday, hour } = localParts(now, timeZone);
  if (weekday !== "Mon" || hour < 9) return false;
  return !lastSentAt || now.getTime() - lastSentAt.getTime() > 6 * 86_400_000;
}

// A week without replies, clicks, subscribers or buyers gets no email.
export function weekHasActivity(week: Report): boolean {
  const t = week.totals;
  return t.replies + t.clicks + t.subscribers + t.buyers > 0;
}

// Yearly plans renew a year after the last payment. The recap goes out once,
// in the week that starts 14 days before the renewal.
export function renewalRecapDue(lastPaidAt: Date | null, now: Date, state: MilestoneState): string | null {
  if (!lastPaidAt) return null;
  const renewal = new Date(lastPaidAt);
  renewal.setUTCFullYear(renewal.getUTCFullYear() + 1);
  const key = renewal.toISOString().slice(0, 10);
  if (state.renewal_recap_for === key) return null;
  const until = renewal.getTime() - now.getTime();
  return until <= 14 * 86_400_000 && until > 7 * 86_400_000 ? key : null;
}
