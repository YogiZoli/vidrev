import { and, eq, ne } from "drizzle-orm";
import { accounts, auditLog, channels, integrations } from "@/db/schema";
import { errorFields, log } from "@/lib/log";
import { DELETION_DONE, DELETION_REQUESTED } from "@/server/account-deletion";
import { writeAudit } from "@/server/accounts";
import type { ChannelDeps } from "./channels";
import { disconnectChannel } from "./channels";
import type { GhlWorkerDeps } from "./ghl";
import { cleanupProspects } from "./prospects";

export interface AccountDeletionDeps {
  channels: ChannelDeps;
  ghl: GhlWorkerDeps;
  // Queues the confirmation email (the email queue retries on its own).
  sendConfirmation: (to: string) => Promise<void>;
}

// Deletes an account whose owner asked for it (server/account-deletion.ts).
// Safe to run again: every step checks what is left.
export async function deleteAccount(deps: AccountDeletionDeps, accountId: string): Promise<"deleted" | "gone" | "not_requested"> {
  const db = deps.channels.db;
  const [account] = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, accountId));
  if (!account) return "gone";
  const requests = await db
    .select({ id: auditLog.id, details: auditLog.details })
    .from(auditLog)
    .where(and(eq(auditLog.accountId, accountId), eq(auditLog.action, DELETION_REQUESTED)));
  if (requests.length === 0) return "not_requested";

  // 1. Beast Mode contacts vidrev made in the connected CRM: after the account
  // is gone nothing could delete them on day 29 (A-29). Best effort: a CRM that
  // refuses (grant revoked) has nothing we can still reach.
  const crms = await db
    .select({ id: integrations.id })
    .from(integrations)
    .where(and(eq(integrations.accountId, accountId), eq(integrations.type, "ghl"), ne(integrations.status, "removed")));
  for (const crm of crms) {
    try {
      await cleanupProspects(deps.ghl, crm.id);
    } catch (error) {
      log("warn", "account deletion: crm cleanup failed, continuing", { accountId, integrationId: crm.id, ...errorFields(error) });
    }
  }

  // 2. Every channel: revoke the Google grant and wipe its YouTube data.
  const owned = await db.select({ id: channels.id, status: channels.status }).from(channels).where(eq(channels.accountId, accountId));
  for (const channel of owned) {
    if (channel.status === "disconnected") continue;
    if (channel.status !== "disconnecting") await db.update(channels).set({ status: "disconnecting" }).where(eq(channels.id, channel.id));
    await disconnectChannel(deps.channels, channel.id);
  }

  // 3. Confirmation to every address the account had, then no address is kept.
  const emails = new Set<string>();
  for (const request of requests) for (const email of (request.details as { emails?: string[] }).emails ?? []) emails.add(email);
  for (const email of emails) await deps.sendConfirmation(email);
  for (const request of requests) {
    const rest: Record<string, unknown> = { ...(request.details as Record<string, unknown>) };
    delete rest.emails;
    await db.update(auditLog).set({ details: rest }).where(eq(auditLog.id, request.id));
  }

  // 4. The account row: every table of the account cascades from it.
  await db.delete(accounts).where(eq(accounts.id, accountId));
  await writeAudit(db, { actor: "system", accountId: null, action: DELETION_DONE, details: { accountId } });
  log("info", "account deleted", { accountId, channels: owned.length, crms: crms.length });
  return "deleted";
}
