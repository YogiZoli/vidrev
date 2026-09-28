import type { Db } from "@/db/client";
import { errorFields, log } from "@/lib/log";
import { writeAudit } from "./accounts";

// Creator and owner actions (Phase 14 review): every change a person makes is
// logged, and kept in audit_log so it can be traced later ("who paused this
// campaign, when"). Recording never breaks the action itself.
export async function recordAction(
  db: Db,
  who: { userId: string; accountId: string },
  action: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  log("info", action, { accountId: who.accountId, userId: who.userId, ...details });
  try {
    await writeAudit(db, { actor: `user:${who.userId}`, accountId: who.accountId, action, details });
  } catch (error) {
    log("error", "audit entry could not be written", { action, accountId: who.accountId, ...errorFields(error) });
  }
}

// An action the app refused (validation, not found, limits): logged as a
// warning with the reason, so "it did not work" has a trace.
export function logRefused(action: string, reason: string, fields: Record<string, unknown> = {}): void {
  log("warn", `${action} refused`, { reason, ...fields });
}
