import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { accounts, users, type CrmSyncMode } from "@/db/schema";
import { beastModeAllowed, effectiveCrmSyncMode, parseBeastAllowlist } from "@/lib/crm-sync-mode";
import { env } from "@/lib/env";
import type { DbOrTx } from "./accounts";

// Whether this account may use Beast Mode (DECISIONS A-25): its id or any of
// its users' emails is on BEAST_MODE_ACCOUNTS.
// `list` defaults to the env value; tests pass their own.
export async function beastModeAllowedFor(db: DbOrTx, accountId: string, list = env().BEAST_MODE_ACCOUNTS): Promise<boolean> {
  const allowlist = parseBeastAllowlist(list);
  if (allowlist.size === 0) return false;
  const rows = await db.select({ email: users.email }).from(users).where(eq(users.accountId, accountId));
  return beastModeAllowed(allowlist, { id: accountId, emails: rows.map((r) => r.email) });
}

export interface CrmSyncModeState {
  saved: CrmSyncMode;
  allowed: boolean;
  effective: CrmSyncMode;
}

export async function crmSyncModeState(db: DbOrTx, accountId: string, list = env().BEAST_MODE_ACCOUNTS): Promise<CrmSyncModeState> {
  const [row] = await db.select({ mode: accounts.crmSyncMode }).from(accounts).where(eq(accounts.id, accountId));
  const saved = row?.mode ?? "clean";
  const allowed = await beastModeAllowedFor(db, accountId, list);
  return { saved, allowed, effective: effectiveCrmSyncMode(saved, allowed) };
}

// Clean is always allowed; Beast only on the allowlist, refused otherwise.
export async function setCrmSyncMode(
  db: Db,
  accountId: string,
  mode: CrmSyncMode,
  list = env().BEAST_MODE_ACCOUNTS,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (mode === "beast" && !(await beastModeAllowedFor(db, accountId, list))) return { ok: false, error: "Beast Mode is coming soon." };
  await db.update(accounts).set({ crmSyncMode: mode, updatedAt: new Date() }).where(eq(accounts.id, accountId));
  return { ok: true };
}
