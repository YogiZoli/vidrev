// Attribution rules (SPEC section 10, DECISIONS B-08, Q-05, Q-06, Q-07).
// Pure functions over first-party rows; the worker loads the rows, runs this
// and writes the result back (src/server/attribution.ts).
//
// 1. Every purchase from every source is stored; duplicates of the same sale
//    across sources are linked to one canonical purchase, so revenue counts
//    once (Q-05). Only money actually paid is revenue; a buyer marker (tag or
//    won opportunity) counts a buyer with revenue "not reported" (Q-06).
// 2. A purchase is attributed to the last touch before it within 180 days
//    (B-08): its own tracking id first (SPEC section 10), else the latest
//    attributed opt-in of the same email.
// 3. Every later payment of a subscription follows the first payment's
//    attribution for the subscription's whole life, window or not (Q-07).
// 4. Net revenue is the amount minus the refunds (B-08). Never estimated.

export const ATTRIBUTION_WINDOW_DAYS = 180;
const WINDOW_MS = ATTRIBUTION_WINDOW_DAYS * 86_400_000;
// The same sale reported by two sources lands within this span.
export const DUPLICATE_WINDOW_MS = 72 * 3_600_000;
// Clocks of form tools, checkouts and CRMs differ; a touch recorded a few
// minutes after the purchase (the checkout creating the contact) still counts.
export const TOUCH_SKEW_MS = 10 * 60_000;

export type AttributionMethod = "tid" | "email" | "subscription";
export type PurchaseSourceName = "stripe" | "ghl" | "webhook";

// A processor of record beats a CRM, a CRM beats a hand-built webhook.
const SOURCE_PRIORITY: Record<PurchaseSourceName, number> = { stripe: 0, ghl: 1, webhook: 2 };

export interface PurchaseFact {
  id: string;
  source: PurchaseSourceName;
  kind: "payment" | "buyer_marker";
  emailNorm: string | null;
  tid: string | null;
  amountCents: number | null;
  currency: string | null;
  refundedCents: number;
  subscriptionRef: string | null;
  occurredAt: Date;
  createdAt: Date;
}

// A touch: the click behind a tracking id, or an attributed opt-in.
export interface Touch {
  at: Date;
  clickId: string | null;
  replyId: string | null;
  campaignId: string | null;
  videoId: string | null;
  keyword: string;
  intent: string | null;
  subscriberId: string | null;
}

export interface AttributionResult {
  canonicalId: string;
  // Net paid amount counted as revenue: only on canonical payments; 0 on
  // duplicates; null on buyer markers (revenue not reported).
  netCents: number | null;
  method: AttributionMethod | null;
  touch: Touch | null;
}

export interface TouchLookup {
  // Non-bot clicks of this account by tracking id.
  clickByTid: ReadonlyMap<string, Touch>;
  // Attributed opt-ins of this account by email, any order.
  optInsByEmail: ReadonlyMap<string, readonly Touch[]>;
}

function isPayment(p: PurchaseFact): boolean {
  return p.kind === "payment" && p.amountCents !== null && p.currency !== null;
}

function sameBuyer(a: PurchaseFact, b: PurchaseFact): boolean {
  return Boolean((a.emailNorm && a.emailNorm === b.emailNorm) || (a.tid && a.tid === b.tid));
}

function byPriority(a: PurchaseFact, b: PurchaseFact): number {
  return (
    SOURCE_PRIORITY[a.source] - SOURCE_PRIORITY[b.source] ||
    a.occurredAt.getTime() - b.occurredAt.getTime() ||
    a.createdAt.getTime() - b.createdAt.getTime() ||
    a.id.localeCompare(b.id)
  );
}

interface Group {
  canonical: PurchaseFact;
  members: PurchaseFact[];
}

// Links duplicates of one sale across sources (Q-05): a payment from another
// source with the same buyer (email or tracking id), currency and amount within
// 72 hours. At most one member per source, so two real purchases reported by
// one source never merge. Buyer markers are never merged: buyers are counted
// by distinct email, so a marker can never add revenue or a second buyer.
export function groupDuplicates(purchases: readonly PurchaseFact[]): Group[] {
  const groups: Group[] = [];
  for (const p of [...purchases].filter(isPayment).sort(byPriority)) {
    let best: Group | null = null;
    for (const group of groups) {
      const c = group.canonical;
      if (group.members.some((m) => m.source === p.source)) continue;
      if (c.currency !== p.currency || c.amountCents !== p.amountCents || !sameBuyer(c, p)) continue;
      const gap = Math.abs(c.occurredAt.getTime() - p.occurredAt.getTime());
      if (gap > DUPLICATE_WINDOW_MS) continue;
      if (!best || gap < Math.abs(best.canonical.occurredAt.getTime() - p.occurredAt.getTime())) best = group;
    }
    if (best) best.members.push(p);
    else groups.push({ canonical: p, members: [p] });
  }
  for (const p of purchases) if (!isPayment(p)) groups.push({ canonical: p, members: [p] });
  return groups;
}

function first<T>(members: readonly PurchaseFact[], pick: (p: PurchaseFact) => T | null): T | null {
  for (const m of members) {
    const value = pick(m);
    if (value !== null) return value;
  }
  return null;
}

function inWindow(touchAt: Date, purchaseAt: Date): boolean {
  const gap = purchaseAt.getTime() - touchAt.getTime();
  return gap >= -TOUCH_SKEW_MS && gap <= WINDOW_MS;
}

// The latest touch of this email that is inside the window before `at`.
export function lastTouchByEmail(touches: readonly Touch[] | undefined, at: Date): Touch | null {
  let best: Touch | null = null;
  for (const t of touches ?? []) {
    if (!inWindow(t.at, at)) continue;
    if (!best || t.at > best.at) best = t;
  }
  return best;
}

export function attributePurchases(purchases: readonly PurchaseFact[], lookup: TouchLookup): Map<string, AttributionResult> {
  const results = new Map<string, AttributionResult>();
  const groups = groupDuplicates(purchases).sort(
    (a, b) => a.canonical.occurredAt.getTime() - b.canonical.occurredAt.getTime() || a.canonical.id.localeCompare(b.canonical.id),
  );
  // Subscription reference of a first payment, with what it was attributed to.
  const subscriptions = new Map<string, { method: AttributionMethod | null; touch: Touch | null }>();

  for (const { canonical, members } of groups) {
    const at = canonical.occurredAt;
    const email = first(members, (m) => m.emailNorm);
    const tid = first(members, (m) => m.tid);
    const subscriptionRef = first(members, (m) => m.subscriptionRef);

    let method: AttributionMethod | null = null;
    let touch: Touch | null = null;
    const earlier = subscriptionRef ? subscriptions.get(subscriptionRef) : undefined;
    if (earlier) {
      // A renewal: same attribution as the first payment, for life (Q-07).
      touch = earlier.touch;
      method = touch ? "subscription" : null;
    } else {
      const click = tid ? lookup.clickByTid.get(tid) : undefined;
      if (click && inWindow(click.at, at)) {
        method = "tid";
        // The opt-in that carried the same tracking id, when there is one.
        const optIn = email ? lookup.optInsByEmail.get(email)?.find((t) => t.clickId === click.clickId) : undefined;
        touch = { ...click, subscriberId: optIn?.subscriberId ?? null };
      } else if (email) {
        touch = lastTouchByEmail(lookup.optInsByEmail.get(email), at);
        method = touch ? "email" : null;
      }
      if (subscriptionRef) subscriptions.set(subscriptionRef, { method, touch });
    }

    const payment = isPayment(canonical);
    const refunded = Math.max(...members.map((m) => m.refundedCents));
    for (const m of members) {
      const isCanonical = m.id === canonical.id;
      results.set(m.id, {
        canonicalId: canonical.id,
        netCents: !payment ? null : isCanonical ? Math.max(0, canonical.amountCents! - refunded) : 0,
        method,
        touch,
      });
    }
  }
  return results;
}
