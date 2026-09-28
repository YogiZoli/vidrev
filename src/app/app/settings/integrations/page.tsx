import { and, eq, ne } from "drizzle-orm";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { CopyMono } from "@/components/motion/CopyButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Meta, Page, PageHeader, SectionTitle } from "@/components/ui/page";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { getDb } from "@/db/client";
import { integrations } from "@/db/schema";
import { appBaseUrl, requireEnv } from "@/lib/env";
import { verifySignedValue } from "@/lib/signed";
import { EVENT_NAMES } from "@/lib/webhooks";
import { requireSession } from "@/server/auth/current";
import { GHL_CLAIM_COOKIE, GHL_CLAIM_PAGE, ghlConfigured } from "@/server/ghl/config";
import { hasPendingInstall } from "@/server/ghl/install";
import { readGhlConfig } from "@/server/ghl/tokens";
import { ensureHookToken } from "@/server/integrations/inbound";
import { readStripeConfig } from "@/server/stripe/connect";
import { listEndpoints, MAX_ENDPOINTS, readConfig, recentDeliveries } from "@/server/integrations/outbound";
import { Notice } from "../../../ui";

export const dynamic = "force-dynamic";

const EVENT_LABELS: Record<(typeof EVENT_NAMES)[number], string> = {
  comment_matched: "Comment matched (a keyword comment got a draft)",
  reply_posted: "Reply posted",
  link_clicked: "Link clicked",
  opt_in: "Subscriber (opt-in)",
  purchase: "Buyer (purchase)",
};

function when(date: Date | null): string {
  return date ? date.toISOString().replace("T", " ").slice(0, 16) + " UTC" : "never";
}

function Mono({ children }: { children: ReactNode }) {
  return <code className="break-all font-mono text-[13px]">{children}</code>;
}

// One small POST button per action.
function ActionForm({ action, id, children, name = "id" }: { action: string; id?: string; children: ReactNode; name?: string }) {
  return (
    <form method="post" action="/api/integrations">
      <input type="hidden" name="action" value={action} />
      {id ? <input type="hidden" name={name} value={id} /> : null}
      <Button type="submit" variant="outline" size="sm">
        {children}
      </Button>
    </form>
  );
}

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { account } = await requireSession();
  const params = await searchParams;
  const db = getDb();
  const key = requireEnv("ENCRYPTION_KEY");
  const endpoints = await listEndpoints(db, account.id);
  const configs = await Promise.all(endpoints.map((endpoint) => readConfig(endpoint, key)));
  const deliveries = await recentDeliveries(db, account.id);
  const hookToken = await ensureHookToken(db, key, account.id);
  const [ghl] = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.accountId, account.id), eq(integrations.type, "ghl"), ne(integrations.status, "removed")));
  const ghlConfig = ghl?.configEnc ? readGhlConfig(ghl.configEnc, key) : null;
  const [stripe] = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.accountId, account.id), eq(integrations.type, "stripe"), ne(integrations.status, "removed")));
  const stripeLast4 = stripe?.configEnc ? readStripeConfig(stripe.configEnc, key).last4 : null;
  // A Marketplace install that waits for this browser's account (Phase 10).
  const claim = verifySignedValue<{ token: string }>((await cookies()).get(GHL_CLAIM_COOKIE)?.value, requireEnv("AUTH_SECRET"));
  const pendingInstall = !ghl && claim ? await hasPendingInstall(db, claim.token) : false;

  // One pulsing primary per page: the first connect action that is on screen.
  const ghlConnect = (!ghl || ghl.status === "error") && ghlConfigured();
  const stripeConnect = !stripe || stripe.status === "error";
  const pulseGhl = ghlConnect;
  const pulseStripe = !pulseGhl && stripeConnect;
  const pulseAdd = !pulseGhl && !pulseStripe;

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
      <PageHeader
        title="Integrations"
        lead="Send every comment, click, subscriber and buyer to your own system: a CRM, n8n, Make, Zapier or your own server. Events never contain comment text or commenter names."
      />
      {params.error ? <Notice tone="error">{params.error}</Notice> : null}
      {params.added ? <Notice tone="info">Endpoint added. Use Send test event to check it.</Notice> : null}
      {params.tested ? <Notice tone="info">Test event queued. It shows up under Recent deliveries in a moment.</Notice> : null}
      {params.rotated ? <Notice tone="info">New signing secret created. Update it in the receiving system.</Notice> : null}
      {params.removed ? <Notice tone="info">Endpoint removed.</Notice> : null}

      {pendingInstall ? (
        <Notice tone="info">
          You installed the app from HighLevel. <a href={GHL_CLAIM_PAGE}>Finish connecting it to this account.</a>
        </Notice>
      ) : null}
      {params.ghl_connected ? <Notice tone="info">GoHighLevel connected. We are setting up the tracking field and reading your contacts.</Notice> : null}
      {params.ghl_disconnected ? <Notice tone="info">GoHighLevel disconnected. Remove the app in GoHighLevel too if you no longer want it there.</Notice> : null}
      {params.ghl_sync ? <Notice tone="info">Sync queued. It runs within a minute.</Notice> : null}
      {params.ghl_saved ? <Notice tone="info">Saved.</Notice> : null}
      {params.stripe_connected ? <Notice tone="info">Stripe connected. We are checking the key and reading your payments.</Notice> : null}
      {params.stripe_disconnected ? <Notice tone="info">Stripe disconnected. Delete or roll the key in your Stripe dashboard too if you no longer want it to exist.</Notice> : null}
      {params.stripe_sync ? <Notice tone="info">Sync queued. It runs within a minute.</Notice> : null}

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
                <Input name="buyerTag" defaultValue={ghlConfig?.buyerTag ?? ""} placeholder="c2c_buyer" className="font-mono" />
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

      <Card className="grid gap-3">
        <SectionTitle>Webhook endpoints</SectionTitle>
        {endpoints.length === 0 ? <Meta className="text-[15px]">No endpoint yet.</Meta> : null}
        {endpoints.map((endpoint, index) => (
          <div key={endpoint.id} className={`grid gap-2 ${index === 0 ? "" : "border-t border-border pt-4"}`}>
            <div className="flex flex-wrap items-center gap-2">
              <strong>{endpoint.label}</strong>
              <Badge tone={endpoint.status === "active" ? "success" : "neutral"}>{endpoint.status === "active" ? "on" : `off (${endpoint.statusReason ?? endpoint.status})`}</Badge>
            </div>
            <Mono>{configs[index]?.url}</Mono>
            <Meta>
              Events: {endpoint.events ? endpoint.events.join(", ") : "all"} · last delivered {when(endpoint.lastSuccessAt)}
              {endpoint.pending > 0 ? ` · ${endpoint.pending} waiting` : ""}
              {endpoint.lastError ? ` · last error: ${endpoint.lastError}` : ""}
            </Meta>
            <details className="rounded-md bg-background p-3 text-sm">
              <summary className="cursor-pointer font-semibold">Signing secret</summary>
              <p className="my-2 text-[13px]">
                Every request carries <Mono>X-Signature: sha256=&lt;HMAC-SHA256 of the raw body&gt;</Mono> made with this secret.
              </p>
              <CopyMono text={configs[index]?.secret ?? ""} />
            </details>
            <div className="flex flex-wrap gap-2">
              {(["test", endpoint.status === "active" ? "disable" : "enable", "rotate", "remove"] as const).map((action) => (
                <ActionForm key={action} action={action} id={endpoint.id}>
                  {{ test: "Send test event", enable: "Turn on", disable: "Turn off", rotate: "New secret", remove: "Remove" }[action]}
                </ActionForm>
              ))}
            </div>
          </div>
        ))}
      </Card>

      {endpoints.length < MAX_ENDPOINTS ? (
        <Card className="grid gap-3">
          <SectionTitle>Add an endpoint</SectionTitle>
          <form method="post" action="/api/integrations" className="grid gap-3">
            <input type="hidden" name="action" value="add" />
            <Field label="Endpoint URL (https)">
              <Input name="url" required placeholder="https://hooks.example.com/vidrev" className="font-mono" />
            </Field>
            <Field label="Name (optional)">
              <Input name="label" placeholder="n8n, CRM..." />
            </Field>
            <fieldset className="m-0 grid gap-1.5 rounded-md border border-border-strong p-3">
              <legend className="px-1 text-sm font-semibold">Events (none ticked means all)</legend>
              {EVENT_NAMES.map((name) => (
                <label key={name} className="flex items-center gap-2 text-[15px]">
                  <input type="checkbox" name="events" value={name} className="size-4 accent-[var(--primary-600)]" /> {EVENT_LABELS[name]}
                </label>
              ))}
            </fieldset>
            <div>
              <Button type="submit" pulse={pulseAdd}>
                Add endpoint
              </Button>
            </div>
          </form>
          <Meta className="text-[15px]">
            Failed deliveries are retried for 24 hours (1 min, 5 min, 15 min, 1 h, 3 h, 6 h, 12 h). Use the <Mono>X-Event-Id</Mono> header to ignore
            repeats. Tags in every event: <Mono>c2c</Mono>, <Mono>c2c_kw_&lt;keyword&gt;</Mono>, <Mono>c2c_vid_&lt;videoId&gt;</Mono>, <Mono>c2c_buyer</Mono>.
          </Meta>
        </Card>
      ) : null}

      <Card className="grid gap-3">
        <SectionTitle>Send us subscribers and buyers</SectionTitle>
        <Meta className="text-[15px]">
          Any form tool, checkout, Zapier, Make or n8n can tell us when someone opts in or buys. That is how a comment turns into a subscriber, a
          buyer and revenue. Send a <Mono>POST</Mono> with your token:
        </Meta>
        <TableWrap>
          <Table>
            <tbody>
              <tr>
                <Th>Subscriber</Th>
                <Td>
                  <CopyMono text={`${appBaseUrl()}/api/hooks/optin`} />
                </Td>
              </tr>
              <tr>
                <Th>Buyer</Th>
                <Td>
                  <CopyMono text={`${appBaseUrl()}/api/hooks/purchase`} />
                </Td>
              </tr>
              <tr>
                <Th>Token</Th>
                <Td>
                  <CopyMono text={hookToken} />
                </Td>
              </tr>
            </tbody>
          </Table>
        </TableWrap>
        <Meta>
          Send the token as <Mono>Authorization: Bearer &lt;token&gt;</Mono>, as <Mono>X-Hook-Token</Mono>, or, if your tool cannot set headers, as{" "}
          <Mono>?token=</Mono> at the end of the URL. JSON and form posts both work.
          <br />
          Subscriber fields: <Mono>email</Mono> (required), <Mono>c2c_tid</Mono> (the hidden field on your form), <Mono>name</Mono>, <Mono>consent_marketing</Mono>. Buyer
          fields: <Mono>email</Mono> or <Mono>c2c_tid</Mono>, <Mono>external_id</Mono> (order id, required), <Mono>amount</Mono> and <Mono>currency</Mono>,{" "}
          <Mono>subscription_id</Mono>, <Mono>refunded_amount</Mono>. Sending the same order again is safe.
        </Meta>
        <form method="post" action="/api/integrations">
          <input type="hidden" name="action" value="hook_rotate" />
          <Button type="submit" variant="outline" size="sm">
            New token
          </Button>
        </form>
        {params.hook_rotated ? <Notice tone="info">New token created. The old one no longer works; update it where you use it.</Notice> : null}
      </Card>

      <Card className="grid gap-3">
        <SectionTitle>Recent deliveries</SectionTitle>
        {deliveries.length === 0 ? <Meta className="text-[15px]">Nothing sent yet.</Meta> : null}
        {deliveries.length > 0 ? (
          <TableWrap>
            <Table>
              <tbody>
                {deliveries.map((d) => (
                  <tr key={d.id}>
                    <Td className="whitespace-nowrap font-mono text-[13px]">{when(d.createdAt)}</Td>
                    <Td>{d.event}</Td>
                    <Td>
                      {d.status}
                      {d.status !== "delivered" && d.lastError ? ` (${d.lastError}, attempt ${d.attempt})` : ""}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        ) : null}
      </Card>
    </Page>
  );
}
