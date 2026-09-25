import { count, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { accounts, channels, plans, users } from "@/db/schema";
import { normalizeEmail } from "@/lib/email";
import { createAccountWithUser, findUserByEmail, writeAudit } from "./accounts";
import { LIVE_STATUSES } from "./channels";

export async function listAccountsForAdmin(db: Db) {
  const rows = await db
    .select({
      accountId: accounts.id,
      email: users.email,
      status: accounts.status,
      planCode: accounts.planCode,
      trialEndsAt: accounts.trialEndsAt,
      fallbackLinksBlocked: accounts.fallbackLinksBlocked,
      createdAt: accounts.createdAt,
    })
    .from(accounts)
    .innerJoin(users, eq(users.accountId, accounts.id))
    .orderBy(desc(accounts.createdAt))
    .limit(500);
  const live = await db
    .select({ accountId: channels.accountId, n: count() })
    .from(channels)
    .where(inArray(channels.status, LIVE_STATUSES))
    .groupBy(channels.accountId);
  const liveByAccount = new Map(live.map((row) => [row.accountId, row.n]));
  return rows.map((row) => ({ ...row, liveChannels: liveByAccount.get(row.accountId) ?? 0 }));
}

export async function listPlans(db: Db) {
  return db.select().from(plans).orderBy(plans.code);
}

export type AdminAction =
  | { kind: "grant"; email: string; planCode: string }
  | { kind: "set_plan"; accountId: string; planCode: string }
  | { kind: "suspend"; accountId: string }
  | { kind: "unsuspend"; accountId: string }
  | { kind: "block_links"; accountId: string; blocked: boolean };

export type AdminResult =
  | { ok: true; message: string; loginLink?: { userId: string; email: string; welcome: boolean } }
  | { ok: false; message: string };

async function planExists(db: Db, code: string): Promise<boolean> {
  const [row] = await db.select({ code: plans.code }).from(plans).where(eq(plans.code, code)).limit(1);
  return Boolean(row);
}

// Every admin change is written to the audit log with the admin's email.
export async function runAdminAction(db: Db, actor: string, action: AdminAction): Promise<AdminResult> {
  if ("planCode" in action && !(await planExists(db, action.planCode))) {
    return { ok: false, message: "Unknown plan." };
  }
  switch (action.kind) {
    case "grant": {
      const email = normalizeEmail(action.email);
      const existing = await findUserByEmail(db, email);
      if (existing) {
        await db
          .update(accounts)
          .set({ planCode: action.planCode, status: "active", suspendedAt: null, updatedAt: new Date() })
          .where(eq(accounts.id, existing.account.id));
        await writeAudit(db, { actor, accountId: existing.account.id, action: "admin.grant", details: { plan: action.planCode } });
        return { ok: true, message: `Updated ${email} to ${action.planCode}.` };
      }
      const created = await createAccountWithUser(db, { email, planCode: action.planCode });
      await writeAudit(db, { actor, accountId: created.account.id, action: "admin.grant", details: { plan: action.planCode } });
      return {
        ok: true,
        message: `Created ${email} on ${action.planCode} and sent a sign-in link.`,
        loginLink: { userId: created.user.id, email, welcome: true },
      };
    }
    case "set_plan":
      await db.update(accounts).set({ planCode: action.planCode, updatedAt: new Date() }).where(eq(accounts.id, action.accountId));
      await writeAudit(db, { actor, accountId: action.accountId, action: "admin.set_plan", details: { plan: action.planCode } });
      return { ok: true, message: "Plan changed." };
    case "suspend":
      await db
        .update(accounts)
        .set({ status: "suspended", suspendedAt: new Date(), updatedAt: new Date() })
        .where(eq(accounts.id, action.accountId));
      await writeAudit(db, { actor, accountId: action.accountId, action: "admin.suspend" });
      return { ok: true, message: "Account suspended." };
    case "unsuspend":
      await db
        .update(accounts)
        .set({ status: "active", suspendedAt: null, updatedAt: new Date() })
        .where(eq(accounts.id, action.accountId));
      await writeAudit(db, { actor, accountId: action.accountId, action: "admin.unsuspend" });
      return { ok: true, message: "Account reactivated." };
    // Kill switch for the shared fallback link host (R-20): its reputation is
    // shared by every customer. Links on the creator's own domain keep working.
    case "block_links":
      await db.update(accounts).set({ fallbackLinksBlocked: action.blocked, updatedAt: new Date() }).where(eq(accounts.id, action.accountId));
      await writeAudit(db, { actor, accountId: action.accountId, action: action.blocked ? "admin.block_fallback_links" : "admin.unblock_fallback_links" });
      return { ok: true, message: action.blocked ? "Fallback links blocked." : "Fallback links allowed." };
  }
}
