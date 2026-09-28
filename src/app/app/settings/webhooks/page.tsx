import { CopyMono } from "@/components/motion/CopyButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Meta, Page, PageHeader, SectionTitle } from "@/components/ui/page";
import { Table, TableWrap, Td } from "@/components/ui/table";
import { getDb } from "@/db/client";
import { requireEnv } from "@/lib/env";
import { EVENT_NAMES } from "@/lib/webhooks";
import { requireSession } from "@/server/auth/current";
import { listEndpoints, MAX_ENDPOINTS, readConfig, recentDeliveries } from "@/server/integrations/outbound";
import { Notice } from "../../../ui";
import { ActionForm, Mono, when } from "../_integrations";

const EVENT_LABELS: Record<(typeof EVENT_NAMES)[number], string> = {
  comment_matched: "Comment matched (a keyword comment got a draft)",
  reply_posted: "Reply posted",
  link_clicked: "Link clicked",
  opt_in: "Subscriber (opt-in)",
  purchase: "Buyer (purchase)",
};

export const dynamic = "force-dynamic";

export default async function WebhooksSettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { account } = await requireSession();
  const params = await searchParams;
  const db = getDb();
  const key = requireEnv("ENCRYPTION_KEY");
  const endpoints = await listEndpoints(db, account.id);
  const configs = await Promise.all(endpoints.map((endpoint) => readConfig(endpoint, key)));
  const deliveries = await recentDeliveries(db, account.id);
  const pulseAdd = endpoints.length === 0;

  return (
    <Page width="md">
      <PageHeader title="Webhooks" lead="Send every comment, click, subscriber and buyer to your own system: n8n, Make, Zapier or your own server. Events never contain comment text or commenter names." />
      <Notice tone="info">Self-service: these tools are for your own developer or automation setup. We do not provide support for connecting other systems.</Notice>
      {params.error ? <Notice tone="error">{params.error}</Notice> : null}
      {params.added ? <Notice tone="info">Endpoint added. Use Send test event to check it.</Notice> : null}
      {params.tested ? <Notice tone="info">Test event queued. It shows up under Recent deliveries in a moment.</Notice> : null}
      {params.rotated ? <Notice tone="info">New signing secret created. Update it in the receiving system.</Notice> : null}
      {params.removed ? <Notice tone="info">Endpoint removed.</Notice> : null}
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
