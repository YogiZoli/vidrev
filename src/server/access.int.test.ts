import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/db/client";
import { accounts } from "@/db/schema";
import { runMigrations } from "@/scripts/migrate";
import { createCoupon, expireTrials, PARTNER_PLAN, redeemCoupon, startTrial } from "./access";
import { createAccountWithUser } from "./accounts";

const hasDb = Boolean(process.env.DATABASE_URL);
const registered = () => createAccountWithUser(getDb(), { email: `access-${randomUUID()}@example.com`, planCode: "standard_monthly", status: "registered" });
const read = async (id: string) => (await getDb().select().from(accounts).where(eq(accounts.id, id)))[0]!;
const code = () => `T${randomUUID().slice(0, 8).toUpperCase()}`;

describe.skipIf(!hasDb)("access: trial, coupons, partner (integration)", () => {
  beforeAll(async () => {
    await runMigrations(process.env.DATABASE_URL!);
  });
  afterAll(async () => {
    await closeDb();
  });

  it("gives one 14 day trial, then locks the account when it ends", async () => {
    const db = getDb();
    const { account } = await registered();
    const now = new Date("2026-10-07T10:00:00Z");
    expect((await startTrial(db, account.id, now)).ok).toBe(true);
    const on = await read(account.id);
    expect(on.status).toBe("active");
    expect(on.trialEndsAt?.toISOString()).toBe("2026-10-21T10:00:00.000Z");
    expect(await startTrial(db, account.id, now)).toEqual({ ok: false, error: "already_active" });

    await expireTrials(db, new Date("2026-10-22T00:00:00Z"));
    expect((await read(account.id)).status).toBe("registered");
    expect(await startTrial(db, account.id)).toEqual({ ok: false, error: "trial_used" });
  });

  it("redeems codes once per account and up to max uses", async () => {
    const db = getDb();
    const partner = code();
    expect((await createCoupon(db, "owner", { code: partner.toLowerCase(), kind: "partner", days: null, maxUses: 1, expiresAt: null, note: null })).ok).toBe(true);
    const a = await registered();
    const b = await registered();
    expect((await redeemCoupon(db, a.account.id, ` ${partner.toLowerCase()} `)).ok).toBe(true);
    expect((await read(a.account.id)).planCode).toBe(PARTNER_PLAN);
    expect(await redeemCoupon(db, a.account.id, partner)).toEqual({ ok: false, error: "coupon_redeemed" });
    expect(await redeemCoupon(db, b.account.id, partner)).toEqual({ ok: false, error: "coupon_used_up" });
    expect(await redeemCoupon(db, b.account.id, "NOPE-NOPE")).toEqual({ ok: false, error: "coupon_unknown" });

    const trial = code();
    await createCoupon(db, "owner", { code: trial, kind: "trial", days: 30, maxUses: null, expiresAt: null, note: null });
    expect((await redeemCoupon(db, b.account.id, trial)).ok).toBe(true);
    expect((await read(b.account.id)).accessSource).toBe("coupon");
  });

  it("never expires Partner access", async () => {
    const db = getDb();
    const partner = code();
    await createCoupon(db, "owner", { code: partner, kind: "partner", days: null, maxUses: null, expiresAt: null, note: null });
    const { account } = await registered();
    await redeemCoupon(db, account.id, partner);
    await expireTrials(db, new Date("2099-01-01T00:00:00Z"));
    expect((await read(account.id)).status).toBe("active");
  });
});
