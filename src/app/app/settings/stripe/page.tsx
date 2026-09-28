import { and, eq, ne } from "drizzle-orm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Meta, Page, PageHeader, SectionTitle } from "@/components/ui/page";
import { getDb } from "@/db/client";
import { integrations } from "@/db/schema";
import { requireEnv } from "@/lib/env";
import { requireSession } from "@/server/auth/current";
import { readStripeConfig } from "@/server/stripe/connect";
import { Notice } from "../../../ui";
import { ActionForm, Mono, when } from "../_integrations";

export const dynamic = "force-dynamic";

export default async function StripeSettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { account } = await requireSession();
  const params = await searchParams;
  const db = getDb();
  const key = requireEnv("ENCRYPTION_KEY");
  const [stripe] = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.accountId, account.id), eq(integrations.type, "stripe"), ne(integrations.status, "removed")));
  const stripeLast4 = stripe?.configEnc ? readStripeConfig(stripe.configEnc, key).last4 : null;
  const stripeConnect = !stripe || stripe.status === "error";
  const pulseStripe = stripeConnect;

  return (
    <Page width="md">
      <PageHeader title="Stripe" lead="Purchases: read-only access to your Stripe payments." />
      {params.error ? <Notice tone="error">{params.error}</Notice> : null}
      {params.stripe_connected ? <Notice tone="info">Stripe connected. We are checking the key and reading your payments.</Notice> : null}
      {params.stripe_disconnected ? <Notice tone="info">Stripe disconnected. Delete or roll the key in your Stripe dashboard too if you no longer want it to exist.</Notice> : null}
      {params.stripe_sync ? <Notice tone="info">Sync queued. It runs within a minute.</Notice> : null}
      <Card className="grid gap-3">
        <SectionTitle>Stripe</SectionTitle>
        <Meta className="text-[15px]">
          Read your Stripe payments, so each video shows what it earned. We use a restricted key that can only read: it cannot charge, refund
          or change anything.
        </Meta>
        {stripeConnect ? (
          <>
            {stripe?.status === "error" ? <Notice tone="error">{stripe.lastError ?? "Stripe stopped working. Paste the key again."}</Notice> : null}
            <details className="rounded-md bg-background p-3 text-[15px]">
              <summary className="cursor-pointer font-semibold">How to create the key</summary>
              <ol className="mb-0 mt-2 grid gap-1 pl-5 text-sm">
                <li>In Stripe, open Developers, then API keys, then Create restricted key.</li>
                <li>Give it Read access to Charges, Customers and Invoices, and no access to anything else.</li>
                <li>
                  Copy the key that starts with <Mono>rk_live_</Mono> and paste it below.
                </li>
              </ol>
            </details>
            <form method="post" action="/api/integrations" className="grid max-w-[420px] gap-3">
              <input type="hidden" name="action" value="stripe_connect" />
              <Field label="Restricted key">
                <Input name="apiKey" type="password" autoComplete="off" placeholder="rk_live_..." className="font-mono" />
              </Field>
              <div>
                <Button type="submit" pulse={pulseStripe}>
                  {stripe ? "Reconnect Stripe" : "Connect Stripe"}
                </Button>
              </div>
            </form>
          </>
        ) : null}
        {stripe && stripe.status === "active" ? (
          <>
            <div className="grid gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <strong>{stripe.label ?? "Stripe"}</strong>
                <Badge tone={stripe.syncState.setup === "done" ? "success" : "live"}>{stripe.syncState.setup === "done" ? "connected" : "checking the key"}</Badge>
              </div>
              <Meta>
                Key ending {stripeLast4 ?? "----"} · last sync {when(stripe.lastSyncedAt)}
                {stripe.lastError ? ` · ${stripe.lastError}` : ""}
              </Meta>
            </div>
            <div className="flex flex-wrap gap-2">
              <ActionForm action="stripe_sync" id={stripe.id}>
                Sync now
              </ActionForm>
              <ActionForm action="stripe_disconnect" id={stripe.id}>
                Disconnect
              </ActionForm>
            </div>
          </>
        ) : null}
      </Card>
    </Page>
  );
}
