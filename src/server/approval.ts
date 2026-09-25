import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { accounts, campaigns, channels, plans, replies, type ReplyStatus } from "@/db/schema";
import { checkReplyAllowance } from "@/lib/plans";
import { type TemplateProblem, templateProblems } from "@/lib/templates";
import { publishLink } from "./links";
import { replyUsage } from "./replies";

// Creator actions on drafts. Every reply is approved one by one (D-25, Q-12);
// all actions are scoped to the signed-in account.

export type ApprovalError = "not_found" | "account_suspended" | "channel_not_connected" | "monthly_cap" | "daily_cap" | TemplateProblem;

export type ApprovalResult = { ok: true } | { ok: false; error: ApprovalError };

// 30 to 180 s jitter before sending (SPEC section 7, reply engine step 6).
export function sendJitterSeconds(random = Math.random): number {
  return 30 + Math.floor(random() * 151);
}

export async function approveReply(db: Db, input: { accountId: string; replyId: string; body: string }, now = new Date()): Promise<ApprovalResult> {
  const body = input.body.trim();
  const problems = templateProblems(body);
  if (problems.length > 0) return { ok: false, error: problems[0]! };
  return db.transaction(async (tx) => {
    // Lock the account row so two approvals cannot both take the last slot.
    const [row] = await tx
      .select({ account: accounts, plan: plans })
      .from(accounts)
      .innerJoin(plans, eq(plans.code, accounts.planCode))
      .where(eq(accounts.id, input.accountId))
      .for("update", { of: accounts });
    if (!row) return { ok: false, error: "not_found" } as const;
    if (row.account.status !== "active") return { ok: false, error: "account_suspended" } as const;
    const [reply] = await tx
      .select({ id: replies.id, channelStatus: channels.status })
      .from(replies)
      .innerJoin(channels, eq(channels.id, replies.channelId))
      .where(and(eq(replies.id, input.replyId), eq(replies.accountId, input.accountId), eq(replies.status, "pending_approval")));
    if (!reply) return { ok: false, error: "not_found" } as const;
    if (reply.channelStatus !== "connected") return { ok: false, error: "channel_not_connected" } as const;
    const allowance = checkReplyAllowance(row.plan, await replyUsage(tx, input.accountId, now));
    if (!allowance.ok) return { ok: false, error: allowance.reason } as const;
    await tx
      .update(replies)
      .set({ status: "approved", approvedAt: now, body, statusReason: null, updatedAt: now })
      .where(eq(replies.id, reply.id));
    return { ok: true } as const;
  });
}

async function setStatus(db: Db, accountId: string, replyId: string, from: ReplyStatus[], values: Partial<typeof replies.$inferInsert>) {
  const rows = await db
    .update(replies)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(replies.id, replyId), eq(replies.accountId, accountId), inArray(replies.status, from)))
    .returning({ id: replies.id });
  return rows.length > 0;
}

export function dismissReply(db: Db, accountId: string, replyId: string) {
  return setStatus(db, accountId, replyId, ["pending_approval", "skipped", "failed", "queued"], { status: "dismissed", queuedForDatePt: null });
}

// "Copy reply and open comment" fallback (0 units): the creator posted it by
// hand. Counts as a reply for the plan caps like any other.
// The tracked link it carried is frozen like an API-posted one.
export async function markSentManually(db: Db, accountId: string, replyId: string, body?: string, now = new Date()): Promise<boolean> {
  const changed = await setStatus(db, accountId, replyId, ["pending_approval", "queued", "failed", "skipped"], {
    status: "sent_manually",
    sentAt: now,
    approvedAt: now,
    queuedForDatePt: null,
    ...(body && templateProblems(body.trim()).length === 0 ? { body: body.trim() } : {}),
  });
  if (!changed) return false;
  const [reply] = await db.select({ linkId: replies.linkId }).from(replies).where(eq(replies.id, replyId));
  if (reply?.linkId) await publishLink(db, reply.linkId, now);
  return true;
}

// Switches a draft to another keyword that matched the same comment (Q-10b).
export async function switchMatch(db: Db, accountId: string, replyId: string, campaignId: string): Promise<boolean> {
  const [reply] = await db
    .select()
    .from(replies)
    .where(and(eq(replies.id, replyId), eq(replies.accountId, accountId), eq(replies.status, "pending_approval")));
  const target = reply?.otherMatches.find((m) => m.campaignId === campaignId);
  if (!reply || !target) return false;
  const [campaign] = await db.select({ id: campaigns.id }).from(campaigns).where(and(eq(campaigns.id, campaignId), eq(campaigns.accountId, accountId)));
  if (!campaign) return false;
  const others = [
    ...reply.otherMatches.filter((m) => m.campaignId !== campaignId),
    ...(reply.campaignId ? [{ campaignId: reply.campaignId, keyword: reply.keyword, intent: reply.intent }] : []),
  ];
  await db
    .update(replies)
    .set({ campaignId, keyword: target.keyword, intent: target.intent, otherMatches: others, updatedAt: new Date() })
    .where(eq(replies.id, reply.id));
  return true;
}
