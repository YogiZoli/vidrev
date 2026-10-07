import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { accounts, couponRedemptions, coupons, plans, type AccessSource, type CouponKind } from "@/db/schema";
import { writeAudit } from "./accounts";

// Access without a checkout (DECISIONS A-20):
// - 14 day free trial, once per account (button on /activate or a trial coupon);
// - Partner access for good: GoHighLevel affiliate snapshot marker, owner grant
//   or a partner coupon.
export const TRIAL_DAYS = 14;
export const PARTNER_PLAN = "ghl_affiliate_free";
const TRIAL_PLAN = "standard_monthly";

export type AccessResult = { ok: true; message: string } | { ok: false; error: AccessError };
export type AccessError = "not_found" | "trial_used" | "already_active" | "coupon_unknown" | "coupon_used_up" | "coupon_expired" | "coupon_redeemed";

export const ACCESS_ERROR_TEXT: Record<AccessError, string> = {
  not_found: "Account not found.",
  trial_used: "This account already had its free trial.",
  already_active: "This account is already active.",
  coupon_unknown: "That code does not exist. Check the spelling.",
  coupon_used_up: "That code has been used up.",
  coupon_expired: "That code has expired.",
  coupon_redeemed: "This account already used that code.",
};

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, "");
}

async function loadAccount(db: Db, accountId: string) {
  const [row] = await db.select().from(accounts).where(eq(accounts.id, accountId)).limit(1);
  return row ?? null;
}

async function grantTrial(db: Db, accountId: string, days: number, source: AccessSource, now: Date) {
  await db
    .update(accounts)
    .set({
      status: "active",
      planCode: TRIAL_PLAN,
      trialEndsAt: new Date(now.getTime() + days * 86_400_000),
      trialUsedAt: now,
      accessSource: source,
      suspendedAt: null,
      updatedAt: now,
    })
    .where(eq(accounts.id, accountId));
}

export async function grantPartner(db: Db, accountId: string, source: AccessSource, actor: string, now = new Date()): Promise<void> {
  await db
    .update(accounts)
    .set({ status: "active", planCode: PARTNER_PLAN, trialEndsAt: null, accessSource: source, suspendedAt: null, updatedAt: now })
    .where(eq(accounts.id, accountId));
  await writeAudit(db, { actor, accountId, action: "access.partner", details: { source } });
}

export async function startTrial(db: Db, accountId: string, now = new Date()): Promise<AccessResult> {
  const account = await loadAccount(db, accountId);
  if (!account) return { ok: false, error: "not_found" };
  if (account.status === "active") return { ok: false, error: "already_active" };
  if (account.trialUsedAt) return { ok: false, error: "trial_used" };
  await grantTrial(db, accountId, TRIAL_DAYS, "trial", now);
  await writeAudit(db, { actor: "user", accountId, action: "access.trial", details: { days: String(TRIAL_DAYS) } });
  return { ok: true, message: `Your ${TRIAL_DAYS} day free trial is on.` };
}

export async function redeemCoupon(db: Db, accountId: string, rawCode: string, now = new Date()): Promise<AccessResult> {
  const code = normalizeCode(rawCode);
  const account = await loadAccount(db, accountId);
  if (!account) return { ok: false, error: "not_found" };
  const [coupon] = await db.select().from(coupons).where(eq(coupons.code, code)).limit(1);
  if (!coupon) return { ok: false, error: "coupon_unknown" };
  if (coupon.expiresAt && coupon.expiresAt <= now) return { ok: false, error: "coupon_expired" };
  // A trial code cannot stack a second trial; a partner code always upgrades.
  if (coupon.kind === "trial" && account.trialUsedAt) return { ok: false, error: "trial_used" };

  try {
    return await db.transaction(async (tx) => {
      const txDb = tx as unknown as Db;
      const [redeemed] = await tx.insert(couponRedemptions).values({ code, accountId, redeemedAt: now }).onConflictDoNothing().returning({ code: couponRedemptions.code });
      if (!redeemed) throw new CouponRefused("coupon_redeemed");
      const [claimed] = await tx
        .update(coupons)
        .set({ uses: sql`${coupons.uses} + 1` })
        .where(and(eq(coupons.code, code), or(isNull(coupons.maxUses), lt(coupons.uses, coupons.maxUses))))
        .returning({ code: coupons.code });
      // Throwing undoes the redemption row above.
      if (!claimed) throw new CouponRefused("coupon_used_up");
      const days = coupon.days ?? TRIAL_DAYS;
      if (coupon.kind === "partner") await grantPartner(txDb, accountId, "coupon", "user", now);
      else {
        await grantTrial(txDb, accountId, days, "coupon", now);
        await writeAudit(txDb, { actor: "user", accountId, action: "access.trial", details: { days: String(days), code } });
      }
      return { ok: true as const, message: coupon.kind === "partner" ? "Partner access is on, free for good." : `Your ${days} day free trial is on.` };
    });
  } catch (error) {
    if (error instanceof CouponRefused) return { ok: false, error: error.reason };
    throw error;
  }
}

class CouponRefused extends Error {
  constructor(readonly reason: AccessError) {
    super(reason);
  }
}

export async function createCoupon(
  db: Db,
  actor: string,
  input: { code: string; kind: CouponKind; days: number | null; maxUses: number | null; expiresAt: Date | null; note: string | null },
): Promise<{ ok: true; code: string } | { ok: false; message: string }> {
  const code = normalizeCode(input.code);
  if (!/^[A-Z0-9-]{4,40}$/.test(code)) return { ok: false, message: "Code: 4 to 40 letters, digits or dashes." };
  if (input.kind === "trial" && (!input.days || input.days < 1 || input.days > 365)) return { ok: false, message: "Trial days: 1 to 365." };
  const [made] = await db
    .insert(coupons)
    .values({ code, kind: input.kind, days: input.kind === "trial" ? input.days : null, maxUses: input.maxUses, expiresAt: input.expiresAt, note: input.note, createdBy: actor })
    .onConflictDoNothing()
    .returning({ code: coupons.code });
  if (!made) return { ok: false, message: "That code already exists." };
  await writeAudit(db, { actor, action: "admin.coupon_created", details: { code, kind: input.kind } });
  return { ok: true, code };
}

export async function listCoupons(db: Db) {
  return db.select().from(coupons).orderBy(sql`${coupons.createdAt} desc`).limit(200);
}

// Hourly: a trial that ran out without a checkout locks the account again
// (status "registered", back on /activate). A checkout clears trialEndsAt.
export async function expireTrials(db: Db, now = new Date()): Promise<number> {
  const free = db.select({ code: plans.code }).from(plans).where(eq(plans.billing, "free_grant"));
  const ended = await db
    .update(accounts)
    .set({ status: "registered", updatedAt: now })
    .where(
      and(
        eq(accounts.status, "active"),
        lt(accounts.trialEndsAt, now),
        or(eq(accounts.accessSource, "trial"), eq(accounts.accessSource, "coupon")),
        sql`${accounts.planCode} not in (${free})`,
      ),
    )
    .returning({ id: accounts.id });
  for (const row of ended) await writeAudit(db, { actor: "system", accountId: row.id, action: "access.trial_ended" });
  return ended.length;
}
