import { desc, eq } from "drizzle-orm";
import { CopyMono } from "@/components/motion/CopyButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Meta, Page, PageHeader, SectionTitle } from "@/components/ui/page";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { getDb } from "@/db/client";
import { campaigns } from "@/db/schema";
import { appBaseUrl, env } from "@/lib/env";
import { cookieDomain, hostOf, suggestHostname } from "@/lib/links";
import { requireSession } from "@/server/auth/current";
import { cnameRecord, guideSteps, providerById } from "@/server/domains/dns";
import { liveDomain } from "@/server/domains/service";
import { Notice, productName } from "../../../ui";

export const dynamic = "force-dynamic";

// "Send to my web person" (D-38): a prefilled email the creator sends from
// their own mail app, so nothing is sent on their behalf.
function webPersonEmail(hostname: string, record: { type: string; name: string; target: string }): string {
  const body = [
    "Hi,",
    "",
    `could you add this DNS record to ${cookieDomain(hostname) ?? hostname}? It lets my comment reply links run on ${hostname}.`,
    "",
    `Type: ${record.type}`,
    `Name / Host: ${record.name}`,
    `Value / Target: ${record.target}`,
    "TTL: default (Auto)",
    "",
    "If the domain uses Cloudflare, set the proxy status to DNS only (grey cloud).",
    "Nothing else changes on the website or email. Thank you!",
  ].join("\n");
  return `mailto:?subject=${encodeURIComponent(`DNS record for ${hostname}`)}&body=${encodeURIComponent(body)}`;
}

function statusLabel(domain: { status: string; dnsOk: boolean }): string {
  if (domain.status === "active") return "Live";
  if (domain.status === "failed") return "Not found. Add the record, then press Check now.";
  return domain.dnsOk ? "DNS found, securing the connection" : "Waiting for the DNS record";
}

export default async function DomainPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { account } = await requireSession();
  const params = await searchParams;
  const db = getDb();
  const domain = await liveDomain(db, account.id);
  const target = env().CUSTOM_HOSTNAME_CNAME_TARGET ?? null;
  const destinations = await db
    .select({ url: campaigns.destinationUrl })
    .from(campaigns)
    .where(eq(campaigns.accountId, account.id))
    .orderBy(desc(campaigns.createdAt));
  // Never suggest a subdomain that already serves the creator's pages.
  const suggestion = suggestHostname(destinations[0]?.url, destinations.map((d) => hostOf(d.url)));
  const record = domain && target ? cnameRecord(domain.hostname, cookieDomain(domain.hostname) ?? domain.hostname, target) : null;
  const provider = providerById(domain?.dnsProvider);
  const guide = domain && record ? guideSteps(provider, { domain: cookieDomain(domain.hostname) ?? domain.hostname, name: record.name, target: record.target }) : null;

  return (
    <Page width="md">
      {/* While a domain is being verified, refresh every 20 seconds. */}
      {domain?.status === "pending" ? <meta httpEquiv="refresh" content="20" /> : null}
      <PageHeader
        title="Your link domain"
        lead={
          <>
            Reply links run on your own domain, for example <code className="font-mono text-sm">go.yourdomain.com/k3x9Tq2</code>. Every click is measured and your opt-in page
            receives the tracking id. {productName()} never touches your website or email.
          </>
        }
      />
      {params.error ? <Notice tone="error">{params.error}</Notice> : null}
      {params.removed ? <Notice tone="info">Domain removed. New replies link straight to your own page.</Notice> : null}

      {!domain ? (
        <Card variant="focus" className="grid gap-3">
          <SectionTitle>Add your domain</SectionTitle>
          <form method="post" action="/api/domain" className="grid gap-3">
            <input type="hidden" name="action" value="add" />
            <Field label="Subdomain for your links">
              <Input name="hostname" required defaultValue={suggestion ?? ""} placeholder="go.yourdomain.com" className="font-mono" />
            </Field>
            <div>
              <Button type="submit" pulse>
                Continue
              </Button>
            </div>
          </form>
          <Meta>
            Use a new subdomain (go, link or get) that is not used yet. Your main domain and website stay as they are. Until your
            domain is live, replies link straight to your own page with the tracking id, so they always show your domain.
          </Meta>
        </Card>
      ) : (
        <Card variant="focus" className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SectionTitle className="font-mono text-base">{domain.hostname}</SectionTitle>
            <Badge tone={domain.status === "active" ? "success" : domain.status === "failed" ? "danger" : "live"}>{statusLabel(domain)}</Badge>
          </div>
          {domain.status === "active" ? <Meta className="text-[15px]">New replies carry links on {domain.hostname}.</Meta> : null}
          {domain.status !== "active" && record && domain.domainConnect ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button asChild pulse>
                <a href="/api/domain/connect">Connect automatically</a>
              </Button>
              <Meta className="text-[15px]">You approve one record at your DNS provider. Or add it by hand:</Meta>
            </div>
          ) : null}
          {domain.status !== "active" && record ? (
            <>
              <p className="m-0 text-[15px]">Add this one record where the DNS of your domain is managed{provider ? ` (${provider.name})` : ""}:</p>
              <TableWrap>
                <Table>
                  <thead>
                    <tr>
                      <Th>Type</Th>
                      <Th>Name / Host</Th>
                      <Th>Value / Target</Th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <Td className="font-mono text-[13px]">{record.type}</Td>
                      <Td>
                        <CopyMono text={record.name} />
                      </Td>
                      <Td>
                        <CopyMono text={record.target} />
                      </Td>
                    </tr>
                  </tbody>
                </Table>
              </TableWrap>
              {guide ? (
                <div className="grid gap-3 rounded-md border p-4">
                  <SectionTitle className="text-base">Step by step{provider ? ` in ${provider.name}` : ""}</SectionTitle>
                  {guide.open ? (
                    <div>
                      <Button asChild variant="outline">
                        <a href={guide.open} target="_blank" rel="noreferrer">
                          Open {provider?.name ?? "your"} DNS
                        </a>
                      </Button>
                    </div>
                  ) : null}
                  <ol className="m-0 grid gap-2 pl-5 text-base leading-relaxed">
                    {guide.steps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                  {provider?.help ? (
                    <Meta className="text-[15px]">
                      Stuck? <a href={provider.help}>{provider.name} help page</a>
                    </Meta>
                  ) : null}
                </div>
              ) : null}
              <Meta className="text-[15px]">
                We check automatically and email you when it is live; this usually takes a few minutes.
                {domain.lastError ? ` Last check: ${domain.lastError}` : ""}
              </Meta>
              <p className="m-0 text-[15px]">
                <a href={webPersonEmail(domain.hostname, record)}>Send these steps to my web person</a>
              </p>
            </>
          ) : null}
          {domain.status !== "active" && !record ? <Notice tone="error">Custom domains are not configured on the server yet.</Notice> : null}
          <div className="flex flex-wrap gap-2">
            <form method="post" action="/api/domain">
              <input type="hidden" name="action" value="check" />
              <input type="hidden" name="domainId" value={domain.id} />
              <Button type="submit" variant="outline">
                Check now
              </Button>
            </form>
            <form method="post" action="/api/domain">
              <input type="hidden" name="action" value="remove" />
              <input type="hidden" name="domainId" value={domain.id} />
              <Button type="submit" variant="outline">
                Remove domain
              </Button>
            </form>
          </div>
          <Meta>
            Links already posted keep {domain.hostname}. They stop working if the DNS record is deleted, so keep it as long as those replies
            matter.
          </Meta>
        </Card>
      )}

      <Card className="grid gap-3">
        <SectionTitle>On your opt-in page</SectionTitle>
        <Meta className="text-[15px]">
          Every link click adds <code className="font-mono text-[13px]">vidrev_tid</code> and UTM parameters (utm_content is the same id) to your opt-in page address. Most form
          tools store UTM values on their own. To be sure, add a hidden field named <code className="font-mono text-[13px]">vidrev_tid</code> to your form and this line to the page:
        </Meta>
        <pre className="m-0 overflow-x-auto whitespace-pre-wrap rounded-md bg-muted p-3 font-mono text-[13px]">{`<script src="${appBaseUrl()}/vidrev.js" async></script>`}</pre>
        <Meta className="text-[15px]">It fills the field, also when the visitor comes back days later.</Meta>
      </Card>
    </Page>
  );
}
