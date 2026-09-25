// Plans are data (SPEC section 6). These seeds are inserted once; later edits
// in the database (admin, SQL) win, because seeding never overwrites a row.
// Caps: 300 replies per month plus a safety ceiling of 30 per channel per day
// on every plan (DECISIONS Q-03 / Q-11). null means "no plan cap".
export type Billing = "monthly" | "annual" | "free_grant" | "custom";

export interface PlanSeed {
  code: string;
  label: string;
  billing: Billing;
  priceLabel: string | null;
  priceCents: number | null;
  priceCurrency: string | null;
  channelLimit: number;
  monthlyReplyCap: number | null;
  dailyReplyCap: number | null;
  seatsCap: number | null;
}

export const PLAN_CODES = ["standard_monthly", "founding", "ghl_affiliate_free", "enterprise", "internal"] as const;
export type PlanCode = (typeof PLAN_CODES)[number];

export const PLAN_SEEDS: readonly PlanSeed[] = [
  {
    code: "standard_monthly",
    label: "Standard",
    billing: "monthly",
    // Price is not decided yet (D-37); set it in the plans table when it is.
    priceLabel: null,
    priceCents: null,
    priceCurrency: null,
    channelLimit: 1,
    monthlyReplyCap: 300,
    dailyReplyCap: 30,
    seatsCap: null,
  },
  {
    code: "founding",
    label: "Founding member",
    billing: "annual",
    priceLabel: "$97/year",
    priceCents: 9700,
    priceCurrency: "USD",
    channelLimit: 1,
    monthlyReplyCap: 300,
    dailyReplyCap: 30,
    seatsCap: 100,
  },
  {
    code: "ghl_affiliate_free",
    label: "Partner access",
    billing: "free_grant",
    priceLabel: null,
    priceCents: null,
    priceCurrency: null,
    channelLimit: 1,
    monthlyReplyCap: 300,
    dailyReplyCap: 30,
    seatsCap: null,
  },
  {
    code: "enterprise",
    label: "Enterprise",
    billing: "custom",
    priceLabel: null,
    priceCents: null,
    priceCurrency: null,
    channelLimit: 1,
    // Enterprise runs on its own GCP project and quota (D-32).
    monthlyReplyCap: null,
    dailyReplyCap: 30,
    seatsCap: null,
  },
  {
    code: "internal",
    label: "Internal",
    billing: "free_grant",
    priceLabel: null,
    priceCents: null,
    priceCurrency: null,
    channelLimit: 1,
    monthlyReplyCap: null,
    dailyReplyCap: 30,
    seatsCap: null,
  },
];

export interface ReplyCaps {
  monthlyReplyCap: number | null;
  dailyReplyCap: number | null;
}

export interface ReplyUsage {
  // Replies already sent or approved for sending in the current Pacific month / day.
  thisMonth: number;
  today: number;
}

export type ReplyAllowance = { ok: true } | { ok: false; reason: "monthly_cap" | "daily_cap" };

// Checked before each reply is scheduled. The monthly cap is the plan limit;
// the daily cap is spam protection, so it applies even when the month has room.
export function checkReplyAllowance(caps: ReplyCaps, usage: ReplyUsage): ReplyAllowance {
  if (caps.monthlyReplyCap !== null && usage.thisMonth >= caps.monthlyReplyCap) {
    return { ok: false, reason: "monthly_cap" };
  }
  if (caps.dailyReplyCap !== null && usage.today >= caps.dailyReplyCap) {
    return { ok: false, reason: "daily_cap" };
  }
  return { ok: true };
}

// Seat alerts for the founding offer (DECISIONS Q-20): GHL stops selling,
// the app only tells the owner. Returns the thresholds crossed by `count`.
export const FOUNDING_ALERT_THRESHOLDS = [90, 100] as const;

export function foundingThresholdsReached(count: number): number[] {
  return FOUNDING_ALERT_THRESHOLDS.filter((threshold) => count >= threshold);
}
