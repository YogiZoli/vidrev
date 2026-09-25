import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { campaigns } from "@/db/schema";
import { appBaseUrl, env } from "@/lib/env";
import { fallbackHost } from "@/lib/link-host";
import { cookieDomain, suggestHostname } from "@/lib/links";
import { requireSession } from "@/server/auth/current";
import { cnameRecord, providerById } from "@/server/domains/dns";
import { liveDomain } from "@/server/domains/service";
import { Notice, productName, styles } from "../../ui";

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
  const fallback = fallbackHost();
  const [latest] = await db
    .select({ url: campaigns.destinationUrl })
    .from(campaigns)
    .where(eq(campaigns.accountId, account.id))
    .orderBy(desc(campaigns.createdAt))
    .limit(1);
  const suggestion = suggestHostname(latest?.url);
  const record = domain && target ? cnameRecord(domain.hostname, cookieDomain(domain.hostname) ?? domain.hostname, target) : null;
  const provider = providerById(domain?.dnsProvider);

  return (
    <main style={styles.main}>
      {/* While a domain is being verified, refresh every 20 seconds. */}
      {domain?.status === "pending" ? <meta httpEquiv="refresh" content="20" /> : null}
      <p>
        <a href="/app">Back</a> · <a href="/app/campaigns">Keywords and replies</a>
      </p>
      <h1>Your link domain</h1>
      <p style={styles.muted}>
        Reply links run on your own domain, for example <code>go.yourdomain.com/k3x9Tq2</code>. Every click is measured and your opt-in page
        receives the tracking id. {productName()} never touches your website or email.
      </p>
      {params.error ? <Notice tone="error">{params.error}</Notice> : null}
      {params.removed ? <Notice tone="info">Domain removed. New replies use {fallback ?? "the default link host"}.</Notice> : null}

      {!domain ? (
        <section style={styles.card}>
          <h2 style={{ marginTop: 0 }}>Add your domain</h2>
          <form method="post" action="/api/domain" style={{ display: "grid", gap: 12 }}>
            <input type="hidden" name="action" value="add" />
            <label>
              Subdomain for your links
              <input name="hostname" required style={styles.input} defaultValue={suggestion ?? ""} placeholder="go.yourdomain.com" />
            </label>
            <button type="submit" style={styles.button}>
              Continue
            </button>
          </form>
          <p style={styles.muted}>
            Use a new subdomain (go, link or get). Your main domain and website stay as they are.
            {fallback ? ` Until your domain is live, replies use ${fallback}.` : ""}
          </p>
        </section>
      ) : (
        <section style={styles.card}>
          <h2 style={{ marginTop: 0 }}>{domain.hostname}</h2>
          <p>
            <strong>{statusLabel(domain)}</strong>
          </p>
          {domain.status === "active" ? <p style={styles.muted}>New replies carry links on {domain.hostname}.</p> : null}
          {domain.status !== "active" && record && domain.domainConnect ? (
            <p>
              <a href="/api/domain/connect" style={{ ...styles.button, display: "inline-block", textDecoration: "none" }}>
                Connect automatically
              </a>{" "}
              <span style={styles.muted}>You approve one record at your DNS provider. Or add it by hand:</span>
            </p>
          ) : null}
          {domain.status !== "active" && record ? (
            <>
              <p>Add this one record where the DNS of your domain is managed{provider ? ` (${provider.name})` : ""}:</p>
              <table style={styles.table}>
                <tbody>
                  <tr>
                    <th style={styles.cell}>Type</th>
                    <th style={styles.cell}>Name / Host</th>
                    <th style={styles.cell}>Value / Target</th>
                  </tr>
                  <tr>
                    <td style={styles.cell}>{record.type}</td>
                    <td style={styles.cell}>
                      <code>{record.name}</code>
                    </td>
                    <td style={styles.cell}>
                      <code>{record.target}</code>
                    </td>
                  </tr>
                </tbody>
              </table>
              {provider ? (
                <p style={styles.muted}>
                  Where: {provider.where}. {provider.note ?? ""} {provider.help ? <a href={provider.help}>Provider guide</a> : null}
                </p>
              ) : null}
              <p style={styles.muted}>
                We check automatically and email you when it is live; this usually takes a few minutes.
                {domain.lastError ? ` Last check: ${domain.lastError}` : ""}
              </p>
              <p>
                <a href={webPersonEmail(domain.hostname, record)}>Send these steps to my web person</a>
              </p>
            </>
          ) : null}
          {domain.status !== "active" && !record ? <Notice tone="error">Custom domains are not configured on the server yet.</Notice> : null}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <form method="post" action="/api/domain">
              <input type="hidden" name="action" value="check" />
              <input type="hidden" name="domainId" value={domain.id} />
              <button type="submit" style={styles.secondary}>
                Check now
              </button>
            </form>
            <form method="post" action="/api/domain">
              <input type="hidden" name="action" value="remove" />
              <input type="hidden" name="domainId" value={domain.id} />
              <button type="submit" style={styles.secondary}>
                Remove domain
              </button>
            </form>
          </div>
          <p style={{ ...styles.muted, fontSize: 13 }}>
            Links already posted keep {domain.hostname}. They stop working if the DNS record is deleted, so keep it as long as those replies
            matter.
          </p>
        </section>
      )}

      <section style={styles.card}>
        <h2 style={{ marginTop: 0 }}>On your opt-in page</h2>
        <p style={styles.muted}>
          Every link click adds <code>c2c_tid</code> and UTM parameters (utm_content is the same id) to your opt-in page address. Most form
          tools store UTM values on their own. To be sure, add a hidden field named <code>c2c_tid</code> to your form and this line to the page:
        </p>
        <pre style={{ whiteSpace: "pre-wrap", fontSize: 13, background: "#f6f6f6", padding: 10, borderRadius: 6 }}>
          {`<script src="${appBaseUrl()}/c2c.js" async></script>`}
        </pre>
        <p style={styles.muted}>It fills the field, also when the visitor comes back days later.</p>
      </section>
    </main>
  );
}
