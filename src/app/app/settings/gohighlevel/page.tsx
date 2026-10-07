import { and, eq, ne } from "drizzle-orm";
import { cookies } from "next/headers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Meta, Page, PageHeader, SectionTitle } from "@/components/ui/page";
import { getDb } from "@/db/client";
import { integrations } from "@/db/schema";
import { requireEnv } from "@/lib/env";
import { verifySignedValue } from "@/lib/signed";
import { requireSession } from "@/server/auth/current";
import { GHL_CLAIM_COOKIE, GHL_CLAIM_PAGE, ghlConfigured } from "@/server/ghl/config";
import { hasPendingInstall } from "@/server/ghl/install";
import { readGhlConfig } from "@/server/ghl/tokens";
import { Notice } from "../../../ui";
import { ActionForm, when } from "../_integrations";
import { CrmSyncModeForm } from "@/components/forms/CrmSyncModeForm";
import { crmSyncModeState } from "@/server/crm-sync-mode";

export const dynamic = "force-dynamic";

export default async function GoHighLevelSettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { account } = await requireSession();
  const params = await searchParams;
  const db = getDb();
  const key = requireEnv("ENCRYPTION_KEY");
  const [ghl] = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.accountId, account.id), eq(integrations.type, "ghl"), ne(integrations.status, "removed")));
  const ghlConfig = ghl?.configEnc ? readGhlConfig(ghl.configEnc, key) : null;
  // A Marketplace install that waits for this browser's account (Phase 10).
  const claim = verifySignedValue<{ token: string }>((await cookies()).get(GHL_CLAIM_COOKIE)?.value, requireEnv("AUTH_SECRET"));
  const pendingInstall = !ghl && claim ? await hasPendingInstall(db, claim.token) : false;
  const syncMode = ghl ? await crmSyncModeState(db, account.id) : null;
  const pulseGhl = (!ghl || ghl.status === "error") && ghlConfigured();

  const ghlState = ghl
    ? ghl.status === "active"
      ? ghl.syncState.setup === "done"
        ? "connected"
        : "setting up"
      : ghl.statusReason === "reauthorize"
        ? "needs to be reconnected"
        : ghl.status
    : null;

  return (
    <Page width="md">
      <PageHeader title="GoHighLevel" lead="Your CRM: subscribers get tagged there, and won opportunities and payments come back here, so each video shows what it earned." />
      {params.error ? <Notice tone="error">{params.error}</Notice> : null}
      {pendingInstall ? (
        <Notice tone="info">
          You installed the app from HighLevel. <a href={GHL_CLAIM_PAGE}>Finish connecting it to this account.</a>
        </Notice>
      ) : null}
      {params.ghl_connected ? <Notice tone="info">GoHighLevel connected. We are setting up the tracking field and reading your contacts.</Notice> : null}
      {params.ghl_disconnected ? <Notice tone="info">GoHighLevel disconnected. Remove the app in GoHighLevel too if you no longer want it there.</Notice> : null}
      {params.ghl_sync ? <Notice tone="info">Sync queued. It runs within a minute.</Notice> : null}
      {params.ghl_saved ? <Notice tone="info">Saved.</Notice> : null}
      {params.mode_saved ? <Notice tone="info">CRM sync mode saved.</Notice> : null}
      <Card className="grid gap-3">
        <SectionTitle>GoHighLevel</SectionTitle>
        {!ghl ? (
          <>
            <Meta className="text-[15px]">
              Connect your GoHighLevel sub-account. Subscribers from your comments get tagged in GoHighLevel, and buyers and payments come back
              here, so each video shows what it earned.
            </Meta>
            {ghlConfigured() ? (
              <div>
                <Button asChild pulse={pulseGhl}>
                  <a href="/api/oauth/crm/start">Connect GoHighLevel</a>
                </Button>
              </div>
            ) : (
              <Meta className="text-[15px]">Connecting GoHighLevel is not available yet.</Meta>
            )}
          </>
        ) : (
          <>
            <div className="grid gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <strong>{ghlConfig?.locationName ?? "GoHighLevel"}</strong>
                <Badge tone={ghlState === "connected" ? "success" : ghl.status === "error" ? "danger" : "live"}>{ghlState}</Badge>
              </div>
              <Meta>
                Last sync {when(ghl.lastSyncedAt)}
                {ghl.lastError ? ` · ${ghl.lastError}` : ""}
              </Meta>
            </div>
            {ghl.status === "error" && ghlConfigured() ? (
              <div>
                <Button asChild pulse={pulseGhl}>
                  <a href="/api/oauth/crm/start">Reconnect</a>
                </Button>
              </div>
            ) : null}
            <form method="post" action="/api/integrations" className="grid max-w-[420px] gap-2">
              <input type="hidden" name="action" value="ghl_buyer_tag" />
              <input type="hidden" name="id" value={ghl.id} />
              <Field label="Buyer tag" hint="A contact with this tag counts as a buyer (revenue not reported). Real payments and won opportunities are read automatically.">
                <Input name="buyerTag" defaultValue={ghlConfig?.buyerTag ?? ""} placeholder="vidrev-buyer" className="font-mono" />
              </Field>
              <div>
                <Button type="submit" variant="outline">
                  Save
                </Button>
              </div>
            </form>
            <div className="flex flex-wrap gap-2">
              <ActionForm action="ghl_sync" id={ghl.id}>
                Sync now
              </ActionForm>
              <ActionForm action="ghl_disconnect" id={ghl.id}>
                Disconnect
              </ActionForm>
            </div>
          </>
        )}
      </Card>
      {syncMode ? (
        <Card className="grid gap-3">
          <SectionTitle>CRM sync mode</SectionTitle>
          <Meta className="text-[15px]">When does a commenter enter your CRM?</Meta>
          <CrmSyncModeForm state={syncMode} returnTo="settings" />
          {syncMode.saved === "beast" ? (
            <Meta>Switching back to Clean Mode stops new contacts; the ones already created still follow the 29 day rule.</Meta>
          ) : null}
        </Card>
      ) : null}
    </Page>
  );
}
