import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/db/client";
import { accounts, auditLog, magicLinkTokens, plans, provisioningEvents } from "@/db/schema";
import { seedAdminAccounts } from "@/db/seed";
import { runMigrations } from "@/scripts/migrate";
import { createAccountWithUser, findUserByEmail } from "./accounts";
import { consumeMagicLink, createSession, deleteSession, findSession, issueMagicLink, MAGIC_LINK_TTL_MS } from "./auth/tokens";
import { handleProvisioning } from "./provisioning/handle";
import { provisioningPayloadSchema } from "./provisioning/payload";

// Runs only where a real Postgres is available (CI service container).
const hasDb = Boolean(process.env.DATABASE_URL);
const email = () => `user-${randomUUID()}@example.com`;
const payload = (input: Record<string, unknown>) => provisioningPayloadSchema.parse({ external_id: randomUUID(), ...input });

describe.skipIf(!hasDb)("accounts, auth and provisioning (integration)", () => {
  beforeAll(async () => {
    await runMigrations(process.env.DATABASE_URL!);
  });

  afterAll(async () => {
    await closeDb();
  });

  describe("seeds", () => {
    it("seeds all plans and keeps later edits", async () => {
      const db = getDb();
      await db.update(plans).set({ priceLabel: "$49/month" }).where(eq(plans.code, "standard_monthly"));
      await runMigrations(process.env.DATABASE_URL!);
      const rows = await db.select().from(plans);
      expect(rows.map((p) => p.code).sort()).toEqual(["enterprise", "founding", "ghl_affiliate_free", "internal", "standard_annual", "standard_monthly"]);
      expect(rows.find((p) => p.code === "standard_monthly")?.priceLabel).toBe("$49/month");
      await db.update(plans).set({ priceLabel: "$25/month" }).where(eq(plans.code, "standard_monthly"));
    });

    it("creates owner accounts once, on the internal plan", async () => {
      const db = getDb();
      const owner = email();
      expect(await seedAdminAccounts(db, [owner.toUpperCase()])).toBe(1);
      expect(await seedAdminAccounts(db, [owner])).toBe(0);
      expect((await findUserByEmail(db, owner))?.account.planCode).toBe("internal");
    });
  });

  describe("magic links and sessions", () => {
    it("signs in once per link", async () => {
      const db = getDb();
      const { user } = await createAccountWithUser(db, { email: email(), planCode: "standard_monthly" });
      const token = (await issueMagicLink(db, user.id))!;
      expect(await consumeMagicLink(db, token)).toBe(user.id);
      expect(await consumeMagicLink(db, token)).toBeNull();
      expect(await consumeMagicLink(db, "not-a-token")).toBeNull();
    });

    it("rejects expired links", async () => {
      const db = getDb();
      const { user } = await createAccountWithUser(db, { email: email(), planCode: "standard_monthly" });
      const issuedAt = new Date(Date.now() - MAGIC_LINK_TTL_MS - 1000);
      const token = (await issueMagicLink(db, user.id, issuedAt))!;
      expect(await consumeMagicLink(db, token)).toBeNull();
    });

    it("rate limits link requests per user", async () => {
      const db = getDb();
      const { user } = await createAccountWithUser(db, { email: email(), planCode: "standard_monthly" });
      for (let i = 0; i < 5; i += 1) expect(await issueMagicLink(db, user.id)).not.toBeNull();
      expect(await issueMagicLink(db, user.id)).toBeNull();
      const rows = await db.select().from(magicLinkTokens).where(eq(magicLinkTokens.userId, user.id));
      expect(rows).toHaveLength(5);
      // Only hashes are stored.
      expect(rows.every((row) => /^[0-9a-f]{64}$/.test(row.tokenHash))).toBe(true);
    });

    it("finds, expires and deletes sessions", async () => {
      const db = getDb();
      const { user } = await createAccountWithUser(db, { email: email(), planCode: "founding" });
      const session = await createSession(db, user.id);
      const found = await findSession(db, session.token);
      expect(found?.user.id).toBe(user.id);
      expect(found?.plan.code).toBe("founding");
      expect(await findSession(db, session.token, new Date(session.expiresAt.getTime() + 1))).toBeNull();
      await deleteSession(db, session.token);
      expect(await findSession(db, session.token)).toBeNull();
    });
  });

  describe("provisioning", () => {
    it("activates a signed-up account on purchase and sends the welcome link", async () => {
      const db = getDb();
      const address = email();
      await createAccountWithUser(db, { email: address, planCode: "standard_monthly", status: "registered" });
      const out = await handleProvisioning(db, payload({ event: "purchase", email: address, plan_code: "standard_monthly", subscription_id: "sub_r" }));
      expect(out.result).toBe("activated");
      expect(out.loginLink?.welcome).toBe(true);
      const found = await findUserByEmail(db, address);
      expect(found?.account.status).toBe("active");
      expect(found?.account.planCode).toBe("standard_monthly");
    });

    it("creates an account on purchase and is idempotent on (event, external_id)", async () => {
      const db = getDb();
      const event = payload({ event: "purchase", email: email(), plan_code: "standard_monthly", subscription_id: "sub_1" });
      const first = await handleProvisioning(db, event);
      expect(first.result).toBe("activated");
      expect(first.loginLink?.welcome).toBe(true);
      const replay = await handleProvisioning(db, event);
      expect(replay.result).toBe("duplicate");
      expect(replay.loginLink).toBeNull();
    });

    it("starts a 14-day trial and converts it on purchase", async () => {
      const db = getDb();
      const address = email();
      const now = new Date("2026-09-25T12:00:00Z");
      const trial = await handleProvisioning(db, payload({ event: "trial_started", email: address, plan_code: "standard_monthly" }), now);
      expect(trial.result).toBe("trial_started");
      const [row] = await db.select().from(accounts).where(eq(accounts.id, trial.accountId!));
      expect(row!.trialEndsAt?.toISOString()).toBe("2026-10-09T12:00:00.000Z");

      const paid = await handleProvisioning(db, payload({ event: "purchase", email: address, plan_code: "standard_monthly" }));
      expect(paid.result).toBe("updated");
      const [after] = await db.select().from(accounts).where(eq(accounts.id, trial.accountId!));
      expect(after!.trialEndsAt).toBeNull();
    });

    it("never downgrades a paying account with a trial event", async () => {
      const db = getDb();
      const address = email();
      await handleProvisioning(db, payload({ event: "purchase", email: address, plan_code: "standard_monthly" }));
      const trial = await handleProvisioning(db, payload({ event: "trial_started", email: address, plan_code: "standard_monthly" }));
      expect(trial.result).toBe("ignored_existing_account");
    });

    it("suspends only for the subscription that activated the account, and reactivates on purchase", async () => {
      const db = getDb();
      const address = email();
      await handleProvisioning(db, payload({ event: "purchase", email: address, plan_code: "founding", subscription_id: "sub_new" }));

      const other = await handleProvisioning(db, payload({ event: "subscription_cancelled", email: address, subscription_id: "sub_old" }));
      expect(other.result).toBe("ignored_other_subscription");

      const failed = await handleProvisioning(db, payload({ event: "payment_failed", email: address, subscription_id: "sub_new" }));
      expect(failed.result).toBe("suspended");

      const back = await handleProvisioning(db, payload({ event: "purchase", email: address, plan_code: "founding", subscription_id: "sub_new" }));
      expect(back.result).toBe("reactivated");
      expect(back.loginLink?.welcome).toBe(false);
    });

    it("ignores cancellations for unknown emails", async () => {
      const result = await handleProvisioning(getDb(), payload({ event: "subscription_cancelled", email: email() }));
      expect(result.result).toBe("ignored_unknown_account");
    });

    it("rejects unknown plans and founding trials, alerts the owner and releases the key for a retry", async () => {
      const db = getDb();
      const unknown = payload({ event: "purchase", email: email(), plan_code: "lifetime" });
      const result = await handleProvisioning(db, unknown);
      expect(result).toMatchObject({ result: "unknown_plan", httpStatus: 422 });
      expect(result.ownerAlerts).toHaveLength(1);
      const kept = await db
        .select()
        .from(provisioningEvents)
        .where(and(eq(provisioningEvents.event, "purchase"), eq(provisioningEvents.externalId, unknown.external_id)));
      expect(kept).toHaveLength(0);

      const foundingTrial = await handleProvisioning(db, payload({ event: "trial_started", email: email(), plan_code: "founding" }));
      expect(foundingTrial).toMatchObject({ result: "founding_has_no_trial", httpStatus: 422 });
    });

    it("changes plans", async () => {
      const db = getDb();
      const address = email();
      await handleProvisioning(db, payload({ event: "purchase", email: address, plan_code: "standard_monthly" }));
      const changed = await handleProvisioning(db, payload({ event: "plan_changed", email: address, plan_code: "enterprise" }));
      expect(changed.result).toBe("plan_changed");
      expect((await findUserByEmail(db, address))?.account.planCode).toBe("enterprise");
    });

    it("alerts the owner once at 90 and once at 100 founding seats", async () => {
      const db = getDb();
      const existing = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.planCode, "founding"));
      for (let i = existing.length; i < 89; i += 1) {
        await createAccountWithUser(db, { email: email(), planCode: "founding" });
      }
      const at90 = await handleProvisioning(db, payload({ event: "purchase", email: email(), plan_code: "founding" }));
      expect(at90.ownerAlerts.map((a) => a.subject)).toEqual(["Founding seats: 90 of 100 sold"]);
      const at91 = await handleProvisioning(db, payload({ event: "purchase", email: email(), plan_code: "founding" }));
      expect(at91.ownerAlerts).toEqual([]);

      for (let i = 91; i < 99; i += 1) await createAccountWithUser(db, { email: email(), planCode: "founding" });
      const at100 = await handleProvisioning(db, payload({ event: "purchase", email: email(), plan_code: "founding" }));
      expect(at100.ownerAlerts.map((a) => a.subject)).toEqual(["Founding seats: 100 of 100 sold"]);
      // Paid purchases above the cap are still accepted (DECISIONS Q-20).
      const over = await handleProvisioning(db, payload({ event: "purchase", email: email(), plan_code: "founding" }));
      expect(over.result).toBe("activated");
      const alerts = await db.select().from(auditLog).where(eq(auditLog.action, "founding.seat_alert"));
      expect(alerts).toHaveLength(2);
    });
  });
});
