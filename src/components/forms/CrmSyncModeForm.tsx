import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Meta } from "@/components/ui/page";
import type { CrmSyncModeState } from "@/server/crm-sync-mode";

// CRM sync mode choice (DECISIONS A-25), in onboarding right after the CRM is
// connected and in Settings. Accounts off the allowlist see Beast Mode as
// Coming soon and cannot post it (the server checks again).
export function CrmSyncModeForm({ state, returnTo }: { state: CrmSyncModeState; returnTo: "onboarding" | "settings" }) {
  const beastSaved = state.saved === "beast";
  return (
    <form method="post" action="/api/crm-sync-mode" className="grid gap-3">
      <input type="hidden" name="return" value={returnTo} />
      <label className="flex items-start gap-3 rounded-md border border-border bg-background p-3">
        <input type="radio" name="mode" value="clean" defaultChecked={!beastSaved} className="mt-1 size-4 flex-none accent-[var(--primary-600)]" />
        <span className="grid gap-0.5">
          <strong>Clean Mode (recommended)</strong>
          <Meta className="text-[15px]">A commenter reaches your CRM only after they opt in with their email. Your CRM holds real leads only.</Meta>
        </span>
      </label>
      <label className={`flex items-start gap-3 rounded-md border border-border bg-background p-3 ${state.allowed ? "" : "opacity-60"}`}>
        <input
          type="radio"
          name="mode"
          value="beast"
          defaultChecked={beastSaved}
          disabled={!state.allowed}
          className="mt-1 size-4 flex-none accent-[var(--primary-600)]"
        />
        <span className="grid gap-1">
          <span className="flex flex-wrap items-center gap-2">
            <strong>Beast Mode</strong>
            {state.allowed ? null : <Badge tone="neutral">Coming soon</Badge>}
            {beastSaved && !state.allowed ? <Badge tone="warning">paused</Badge> : null}
          </span>
          <Meta className="text-[15px]">
            Every viewer who comments a trigger keyword becomes a contact in your CRM right away, with their YouTube display name and no email, and
            the comment opens a conversation there. You approve or write the reply in your CRM; nothing is posted without you.
          </Meta>
          {state.allowed ? (
            <span className="grid gap-2 rounded-md bg-warning-surface p-2 text-[15px] text-warning-text">
              <span>
                Warning: commenters who never opted in will enter your CRM. Contacts that do not opt in within 29 days are deleted from your CRM
                together with their conversation. Contacts that were already in your CRM are never deleted.
              </span>
              <span className="flex items-start gap-2">
                <input type="checkbox" name="confirm" value="1" defaultChecked={beastSaved} className="mt-1 size-4 flex-none accent-[var(--primary-600)]" />
                <span>I understand that commenters who never opted in will enter my CRM.</span>
              </span>
            </span>
          ) : null}
        </span>
      </label>
      <div>
        <Button type="submit" variant="outline" size="sm">
          Save CRM sync mode
        </Button>
      </div>
    </form>
  );
}
