import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { accounts, plans, provisioningEvents } from "@/db/schema";
import { foundingThresholdsReached } from "@/lib/plans";
import {
  countAccountsOnPlan,
  createAccountWithUser,
  findUserByEmail,
  hasAudit,
  type Tx,
  writeAudit,
} from "@/server/accounts";
import type { ProvisioningPayload } from "./payload";

export const TRIAL_DAYS = 14;
const SOURCE = "ghl";

export type ProvisioningResult =
  | "activated"
  | "reactivated"
  | "updated"
  | "trial_started"
  | "suspended"
  | "plan_changed"
  | "duplicate"
  | "ignored_unknown_account"
  | "ignored_other_subscription"
  | "ignored_existing_account"
  | "unknown_plan"
  | "founding_has_no_trial";

export interface ProvisioningOutcome {
  result: ProvisioningResult;
  httpStatus: 200 | 422;
  accountId: string | null;
  // Side effects for the caller to run after the transaction commits.
  loginLink: { userId: string; email: string; welcome: boolean } | null;
  ownerAlerts: { subject: string; lines: string[] }[];
}

function outcome(result: ProvisioningResult, extra: Partial<ProvisioningOutcome> = {}): ProvisioningOutcome {
  const rejected = result === "unknown_plan" || result === "founding_has_no_trial";
  return { result, httpStatus: rejected ? 422 : 200, accountId: null, loginLink: null, ownerAlerts: [], ...extra };
}

export async function handleProvisioning(db: Db, payload: ProvisioningPayload, now = new Date()): Promise<ProvisioningOutcome> {
  return db.transaction(async (tx) => {
    // Claim the idempotency key first; a replay stops here.
    const [claimed] = await tx
      .insert(provisioningEvents)
      .values({ source: SOURCE, event: payload.event, externalId: payload.external_id, payload, result: "pending" })
      .onConflictDoNothing()
      .returning({ id: provisioningEvents.id });
    if (!claimed) return outcome("duplicate");

    const result = await apply(tx, payload, now);
    if (result.httpStatus !== 200) {
      // Release the key so the same event is processed once the owner fixes
      // the setup and GHL (or the owner) resends it.
      await tx.delete(provisioningEvents).where(eq(provisioningEvents.id, claimed.id));
      return result;
    }
    await tx
      .update(provisioningEvents)
      .set({ result: result.result, accountId: result.accountId })
      .where(eq(provisioningEvents.id, claimed.id));
    return result;
  });
}

async function apply(tx: Tx, payload: ProvisioningPayload, now: Date): Promise<ProvisioningOutcome> {
  switch (payload.event) {
    case "purchase":
    case "subscription_created":
      return activate(tx, payload, null);
    case "trial_started":
      if (payload.plan_code === "founding") {
        return outcome("founding_has_no_trial", {
          ownerAlerts: [alert("Trial event for the founding plan", payload, "The founding offer has no trial (DECISIONS Q-16). Check the GHL workflow.")],
        });
      }
      return activate(tx, payload, payload.trial_ends_at ?? new Date(now.getTime() + TRIAL_DAYS * 86_400_000));
    case "plan_changed":
      return changePlan(tx, payload);
    case "subscription_cancelled":
    case "payment_failed":
      return suspend(tx, payload, now);
  }
}

async function planExists(tx: Tx, code: string | undefined): Promise<boolean> {
  if (!code) return false;
  const [row] = await tx.select({ code: plans.code }).from(plans).where(eq(plans.code, code)).limit(1);
  return Boolean(row);
}

function alert(subject: string, payload: ProvisioningPayload, reason: string) {
  return {
    subject,
    lines: [reason, `Event: ${payload.event}`, `Email: ${payload.email}`, `Plan code: ${payload.plan_code ?? "(none)"}`, `External id: ${payload.external_id}`],
  };
}

async function activate(tx: Tx, payload: ProvisioningPayload, trialEndsAt: Date | null): Promise<ProvisioningOutcome> {
  const planCode = payload.plan_code;
  if (!planCode || !(await planExists(tx, planCode))) {
    // A paid purchase is never silently dropped: GHL sees the failure and the
    // owner gets an email to fix the plan code.
    return outcome("unknown_plan", {
      ownerAlerts: [alert("Provisioning failed: unknown plan code", payload, "A checkout arrived with a plan code that is not in the plans table.")],
    });
  }
  const existing = await findUserByEmail(tx, payload.email);

  let result: ProvisioningResult;
  let accountId: string;
  let loginLink: ProvisioningOutcome["loginLink"] = null;

  if (!existing) {
    const created = await createAccountWithUser(tx, {
      email: payload.email,
      name: payload.name,
      planCode,
      trialEndsAt,
      billingRef: payload.subscription_id ?? null,
    });
    accountId = created.account.id;
    result = trialEndsAt ? "trial_started" : "activated";
    loginLink = { userId: created.user.id, email: created.user.email, welcome: true };
  } else {
    accountId = existing.account.id;
    if (trialEndsAt && existing.account.status === "active" && !existing.account.trialEndsAt) {
      // A trial event for a paying account must not downgrade it.
      return outcome("ignored_existing_account", { accountId });
    }
    const wasSuspended = existing.account.status === "suspended";
    await tx
      .update(accounts)
      .set({
        status: "active",
        planCode,
        trialEndsAt,
        suspendedAt: null,
        billingRef: payload.subscription_id ?? existing.account.billingRef,
        updatedAt: new Date(),
      })
      .where(eq(accounts.id, accountId));
    result = wasSuspended ? "reactivated" : existing.account.status === "registered" ? "activated" : "updated";
    // A signed-up account that pays now gets the welcome link like a new one.
    if (existing.account.status === "registered") loginLink = { userId: existing.user.id, email: existing.user.email, welcome: true };
    else if (wasSuspended) loginLink = { userId: existing.user.id, email: existing.user.email, welcome: false };
  }

  await writeAudit(tx, { actor: "ghl", accountId, action: `provisioning.${result}`, details: { event: payload.event, plan: planCode } });
  const ownerAlerts = planCode === "founding" ? await foundingAlerts(tx) : [];
  return outcome(result, { accountId, loginLink, ownerAlerts });
}

// Q-20: GHL stops selling at 100; the app only alerts the owner, once per threshold.
async function foundingAlerts(tx: Tx): Promise<ProvisioningOutcome["ownerAlerts"]> {
  const count = await countAccountsOnPlan(tx, "founding");
  const alerts: ProvisioningOutcome["ownerAlerts"] = [];
  for (const threshold of foundingThresholdsReached(count)) {
    if (await hasAudit(tx, "founding.seat_alert", "threshold", String(threshold))) continue;
    await writeAudit(tx, { actor: "system", action: "founding.seat_alert", details: { threshold: String(threshold), count } });
    alerts.push({
      subject: `Founding seats: ${count} of 100 sold`,
      lines: [
        `${count} accounts are on the founding plan (threshold ${threshold}).`,
        threshold >= 100 ? "Stop selling the founding offer in GHL now." : "Prepare to close the founding offer in GHL.",
      ],
    });
  }
  return alerts;
}

async function changePlan(tx: Tx, payload: ProvisioningPayload): Promise<ProvisioningOutcome> {
  const planCode = payload.plan_code;
  if (!planCode || !(await planExists(tx, planCode))) {
    return outcome("unknown_plan", {
      ownerAlerts: [alert("Plan change failed: unknown plan code", payload, "A plan change arrived with a plan code that is not in the plans table.")],
    });
  }
  const existing = await findUserByEmail(tx, payload.email);
  if (!existing) return outcome("ignored_unknown_account");
  await tx
    .update(accounts)
    .set({ planCode, updatedAt: new Date() })
    .where(eq(accounts.id, existing.account.id));
  await writeAudit(tx, {
    actor: "ghl",
    accountId: existing.account.id,
    action: "provisioning.plan_changed",
    details: { from: existing.account.planCode, to: planCode },
  });
  const ownerAlerts = payload.plan_code === "founding" ? await foundingAlerts(tx) : [];
  return outcome("plan_changed", { accountId: existing.account.id, ownerAlerts });
}

async function suspend(tx: Tx, payload: ProvisioningPayload, now: Date): Promise<ProvisioningOutcome> {
  const existing = await findUserByEmail(tx, payload.email);
  if (!existing) return outcome("ignored_unknown_account");
  const ref = existing.account.billingRef;
  if (payload.subscription_id && ref && payload.subscription_id !== ref) {
    return outcome("ignored_other_subscription", { accountId: existing.account.id });
  }
  // Suspension stops polling and sending; first-party data is kept (SPEC-REVIEW R-26).
  await tx
    .update(accounts)
    .set({ status: "suspended", suspendedAt: now, updatedAt: now })
    .where(eq(accounts.id, existing.account.id));
  await writeAudit(tx, { actor: "ghl", accountId: existing.account.id, action: "provisioning.suspended", details: { event: payload.event } });
  return outcome("suspended", { accountId: existing.account.id });
}
