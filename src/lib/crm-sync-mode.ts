import type { CrmSyncMode } from "@/db/schema";

// CRM sync mode (DECISIONS A-25). Clean is the default and today's behaviour;
// Beast Mode is open only to the allowlist until the LLC and the Google OAuth
// review, which must disclose its data flow.
export const CRM_SYNC_MODES = ["clean", "beast"] as const satisfies readonly CrmSyncMode[];

export function parseCrmSyncMode(value: string): CrmSyncMode | null {
  return (CRM_SYNC_MODES as readonly string[]).includes(value) ? (value as CrmSyncMode) : null;
}

// BEAST_MODE_ACCOUNTS: comma (or space) separated account ids or emails,
// compared without letter case.
export function parseBeastAllowlist(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(/[\s,]+/)
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function beastModeAllowed(allowlist: Set<string>, account: { id: string; emails: readonly string[] }): boolean {
  if (allowlist.size === 0) return false;
  return allowlist.has(account.id.toLowerCase()) || account.emails.some((email) => allowlist.has(email.trim().toLowerCase()));
}

// What the worker acts on: a saved Beast Mode stops counting the moment the
// account leaves the allowlist (no new prospects; existing ones still follow
// the 29 day rule).
export function effectiveCrmSyncMode(saved: CrmSyncMode, allowed: boolean): CrmSyncMode {
  return saved === "beast" && allowed ? "beast" : "clean";
}
