import { and, desc, eq, inArray, ne } from "drizzle-orm";
import type { Db } from "@/db/client";
import { accounts, plans, provisioningEvents, users } from "@/db/schema";
import type { SendEmailJob } from "@/jobs/queues";
import { formatMoney } from "@/lib/money";
import { type MilestoneState, newMilestones, renewalRecapDue, weekHasActivity, weeklyEmailDue } from "@/lib/notifications";
import type { Period, Report } from "@/lib/report";
import { milestoneEmail, renewalRecapEmail, weeklySummaryEmail } from "@/server/email/templates";

// Retention emails (R-35), checked after every report refresh so they use the
// fresh numbers. Each one is recorded on the account before it is queued, so
// a retry never sends it twice.

export interface NotifyDeps {
  db: Db;
  appBaseUrl: string;
  productName: string;
  sendEmail: (job: SendEmailJob) => Promise<void>;
}

async function recipients(db: Db, accountId: string): Promise<string[]> {
  const rows = await db.select({ email: users.email }).from(users).where(eq(users.accountId, accountId));
  return rows.map((r) => r.email);
}

// The latest paid provisioning event: yearly plans renew a year after it.
async function lastPaidAt(db: Db, accountId: string): Promise<Date | null> {
  const [row] = await db
    .select({ receivedAt: provisioningEvents.receivedAt })
    .from(provisioningEvents)
    .where(and(eq(provisioningEvents.accountId, accountId), inArray(provisioningEvents.event, ["purchase", "subscription_created"]), ne(provisioningEvents.result, "pending")))
    .orderBy(desc(provisioningEvents.receivedAt))
    .limit(1);
  return row?.receivedAt ?? null;
}

export async function sendRetentionEmails(deps: NotifyDeps, accountId: string, reports: Record<Period, Report>, now = new Date()): Promise<void> {
  const [row] = await deps.db.select({ account: accounts, plan: plans }).from(accounts).innerJoin(plans, eq(plans.code, accounts.planCode)).where(eq(accounts.id, accountId));
  // Suspended accounts are not measured, so there is nothing new to tell.
  if (!row || row.account.status !== "active") return;
  const { account, plan } = row;
  const state: MilestoneState = { ...account.milestones };
  const reportUrl = `${deps.appBaseUrl}/app/reports`;
  let to: string[] | null = null;
  const send = async (build: (email: string) => SendEmailJob) => {
    to ??= await recipients(deps.db, accountId);
    for (const email of to) await deps.sendEmail(build(email));
  };

  const reached = newMilestones(reports.all_time, state);
  const renewal = plan.billing === "annual" ? renewalRecapDue(await lastPaidAt(deps.db, accountId), now, state) : null;
  const weekly = account.weeklyEmail && weeklyEmailDue(now, account.reportTimezone, account.weeklyEmailSentAt) && weekHasActivity(reports.last_7);
  if (reached.length === 0 && !renewal && !weekly) return;

  for (const milestone of reached) state[milestone] = now.toISOString();
  if (renewal) state.renewal_recap_for = renewal;
  await deps.db
    .update(accounts)
    .set({ milestones: state as Record<string, string>, ...(weekly ? { weeklyEmailSentAt: now } : {}) })
    .where(eq(accounts.id, accountId));

  // Only the highest new milestone: a first buyer implies the first click.
  const top = reached.at(-1);
  if (top) await send((email) => milestoneEmail({ to: email, milestone: top, url: reportUrl, productName: deps.productName }));
  if (weekly) {
    const t = reports.last_7.totals;
    await send((email) =>
      weeklySummaryEmail({
        to: email,
        revenue: formatMoney(t.revenueCents, reports.last_7.currency),
        clicks: t.clicks,
        subscribers: t.subscribers,
        buyers: t.buyers,
        url: `${reportUrl}?period=last_7`,
        settingsUrl: `${reportUrl}#settings`,
        productName: deps.productName,
      }),
    );
  }
  if (renewal) {
    await send((email) =>
      renewalRecapEmail({
        to: email,
        renewalDate: renewal,
        lifetime: formatMoney(reports.all_time.totals.revenueCents, reports.all_time.currency),
        price: plan.priceCents !== null && plan.priceCurrency ? `${formatMoney(plan.priceCents, plan.priceCurrency)} a year` : null,
        productName: deps.productName,
        url: reportUrl,
      }),
    );
  }
}
