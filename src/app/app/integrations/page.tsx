import { getDb } from "@/db/client";
import { requireEnv } from "@/lib/env";
import { EVENT_NAMES } from "@/lib/webhooks";
import { requireSession } from "@/server/auth/current";
import { listEndpoints, MAX_ENDPOINTS, readConfig, recentDeliveries } from "@/server/integrations/outbound";
import { Notice, styles } from "../../ui";

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

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { account } = await requireSession();
  const params = await searchParams;
  const db = getDb();
  const key = requireEnv("ENCRYPTION_KEY");
  const endpoints = await listEndpoints(db, account.id);
  const configs = await Promise.all(endpoints.map((endpoint) => readConfig(endpoint, key)));
  const deliveries = await recentDeliveries(db, account.id);

  return (
    <main style={styles.main}>
      <p>
        <a href="/app">Back</a>
      </p>
      <h1>Integrations</h1>
      <p style={styles.muted}>
        Send every comment, click, subscriber and buyer to your own system: a CRM, n8n, Make, Zapier or your own server. Events never contain
        comment text or commenter names.
      </p>
      {params.error ? <Notice tone="error">{params.error}</Notice> : null}
      {params.added ? <Notice tone="info">Endpoint added. Use Send test event to check it.</Notice> : null}
      {params.tested ? <Notice tone="info">Test event queued. It shows up under Recent deliveries in a moment.</Notice> : null}
      {params.rotated ? <Notice tone="info">New signing secret created. Update it in the receiving system.</Notice> : null}
      {params.removed ? <Notice tone="info">Endpoint removed.</Notice> : null}

      <section style={styles.card}>
        <h2 style={{ marginTop: 0 }}>Webhook endpoints</h2>
        {endpoints.length === 0 ? <p style={styles.muted}>No endpoint yet.</p> : null}
        {endpoints.map((endpoint, index) => (
          <div key={endpoint.id} style={{ borderTop: index === 0 ? 0 : "1px solid #eee", padding: "12px 0" }}>
            <strong>{endpoint.label}</strong> <span style={styles.muted}>{endpoint.status === "active" ? "on" : `off (${endpoint.statusReason ?? endpoint.status})`}</span>
            <br />
            <code style={{ fontSize: 13, wordBreak: "break-all" }}>{configs[index]?.url}</code>
            <p style={{ ...styles.muted, margin: "4px 0", fontSize: 13 }}>
              Events: {endpoint.events ? endpoint.events.join(", ") : "all"} · last delivered {when(endpoint.lastSuccessAt)}
              {endpoint.pending > 0 ? ` · ${endpoint.pending} waiting` : ""}
              {endpoint.lastError ? ` · last error: ${endpoint.lastError}` : ""}
            </p>
            <details>
              <summary>Signing secret</summary>
              <p style={{ fontSize: 13 }}>
                Every request carries <code>X-Signature: sha256=&lt;HMAC-SHA256 of the raw body&gt;</code> made with this secret.
              </p>
              <code style={{ wordBreak: "break-all" }}>{configs[index]?.secret}</code>
            </details>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
              {(["test", endpoint.status === "active" ? "disable" : "enable", "rotate", "remove"] as const).map((action) => (
                <form key={action} method="post" action="/api/integrations">
                  <input type="hidden" name="action" value={action} />
                  <input type="hidden" name="id" value={endpoint.id} />
                  <button type="submit" style={styles.secondary}>
                    {{ test: "Send test event", enable: "Turn on", disable: "Turn off", rotate: "New secret", remove: "Remove" }[action]}
                  </button>
                </form>
              ))}
            </div>
          </div>
        ))}
      </section>

      {endpoints.length < MAX_ENDPOINTS ? (
        <section style={styles.card}>
          <h2 style={{ marginTop: 0 }}>Add an endpoint</h2>
          <form method="post" action="/api/integrations" style={{ display: "grid", gap: 12 }}>
            <input type="hidden" name="action" value="add" />
            <label>
              Endpoint URL (https)
              <input name="url" required style={styles.input} placeholder="https://hooks.example.com/vidrev" />
            </label>
            <label>
              Name (optional)
              <input name="label" style={styles.input} placeholder="n8n, CRM..." />
            </label>
            <fieldset style={{ border: "1px solid #ddd", borderRadius: 6 }}>
              <legend>Events (none ticked means all)</legend>
              {EVENT_NAMES.map((name) => (
                <label key={name} style={{ display: "block", padding: "2px 0" }}>
                  <input type="checkbox" name="events" value={name} /> {EVENT_LABELS[name]}
                </label>
              ))}
            </fieldset>
            <button type="submit" style={styles.button}>
              Add endpoint
            </button>
          </form>
          <p style={styles.muted}>
            Failed deliveries are retried for 24 hours (1 min, 5 min, 15 min, 1 h, 3 h, 6 h, 12 h). Use the <code>X-Event-Id</code> header to ignore
            repeats. Tags in every event: <code>c2c</code>, <code>c2c_kw_&lt;keyword&gt;</code>, <code>c2c_vid_&lt;videoId&gt;</code>,{" "}
            <code>c2c_buyer</code>.
          </p>
        </section>
      ) : null}

      <section style={styles.card}>
        <h2 style={{ marginTop: 0 }}>Recent deliveries</h2>
        {deliveries.length === 0 ? <p style={styles.muted}>Nothing sent yet.</p> : null}
        {deliveries.length > 0 ? (
          <table style={styles.table}>
            <tbody>
              {deliveries.map((d) => (
                <tr key={d.id}>
                  <td style={styles.cell}>{when(d.createdAt)}</td>
                  <td style={styles.cell}>{d.event}</td>
                  <td style={styles.cell}>
                    {d.status}
                    {d.status !== "delivered" && d.lastError ? ` (${d.lastError}, attempt ${d.attempt})` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>
    </main>
  );
}
