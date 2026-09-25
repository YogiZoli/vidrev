import { and, eq, ne } from "drizzle-orm";
import { getDb } from "@/db/client";
import { integrations } from "@/db/schema";
import { appBaseUrl, requireEnv } from "@/lib/env";
import { EVENT_NAMES } from "@/lib/webhooks";
import { requireSession } from "@/server/auth/current";
import { ghlConfigured } from "@/server/ghl/config";
import { readGhlConfig } from "@/server/ghl/tokens";
import { ensureHookToken } from "@/server/integrations/inbound";
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
  const hookToken = await ensureHookToken(db, key, account.id);
  const [ghl] = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.accountId, account.id), eq(integrations.type, "ghl"), ne(integrations.status, "removed")));
  const ghlConfig = ghl?.configEnc ? readGhlConfig(ghl.configEnc, key) : null;

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

      {params.ghl_connected ? <Notice tone="info">GoHighLevel connected. We are setting up the tracking field and reading your contacts.</Notice> : null}
      {params.ghl_disconnected ? <Notice tone="info">GoHighLevel disconnected. Remove the app in GoHighLevel too if you no longer want it there.</Notice> : null}
      {params.ghl_sync ? <Notice tone="info">Sync queued. It runs within a minute.</Notice> : null}
      {params.ghl_saved ? <Notice tone="info">Saved.</Notice> : null}

      <section style={styles.card}>
        <h2 style={{ marginTop: 0 }}>GoHighLevel</h2>
        {!ghl ? (
          <>
            <p style={styles.muted}>
              Connect your GoHighLevel sub-account. Subscribers from your comments get tagged in GoHighLevel, and buyers and payments come back
              here, so each video shows what it earned.
            </p>
            {ghlConfigured() ? (
              <p>
                <a href="/api/oauth/crm/start" style={{ ...styles.button, display: "inline-block", textDecoration: "none" }}>
                  Connect GoHighLevel
                </a>
              </p>
            ) : (
              <p style={styles.muted}>Connecting GoHighLevel is not available yet.</p>
            )}
          </>
        ) : (
          <>
            <p>
              <strong>{ghlConfig?.locationName ?? "GoHighLevel"}</strong>{" "}
              <span style={styles.muted}>
                {ghl.status === "active"
                  ? ghl.syncState.setup === "done"
                    ? "connected"
                    : "setting up"
                  : ghl.statusReason === "reauthorize"
                    ? "needs to be reconnected"
                    : ghl.status}
              </span>
              <br />
              <span style={{ ...styles.muted, fontSize: 13 }}>
                Last sync {when(ghl.lastSyncedAt)}
                {ghl.lastError ? ` · ${ghl.lastError}` : ""}
              </span>
            </p>
            {ghl.status === "error" && ghlConfigured() ? (
              <p>
                <a href="/api/oauth/crm/start" style={{ ...styles.button, display: "inline-block", textDecoration: "none" }}>
                  Reconnect
                </a>
              </p>
            ) : null}
            <form method="post" action="/api/integrations" style={{ display: "grid", gap: 8, maxWidth: 420 }}>
              <input type="hidden" name="action" value="ghl_buyer_tag" />
              <input type="hidden" name="id" value={ghl.id} />
              <label>
                Buyer tag
                <input name="buyerTag" style={styles.input} defaultValue={ghlConfig?.buyerTag ?? ""} placeholder="c2c_buyer" />
              </label>
              <span style={{ ...styles.muted, fontSize: 13 }}>
                A contact with this tag counts as a buyer (revenue not reported). Real payments and won opportunities are read automatically.
              </span>
              <button type="submit" style={styles.secondary}>
                Save
              </button>
            </form>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
              {(["ghl_sync", "ghl_disconnect"] as const).map((action) => (
                <form key={action} method="post" action="/api/integrations">
                  <input type="hidden" name="action" value={action} />
                  <input type="hidden" name="id" value={ghl.id} />
                  <button type="submit" style={styles.secondary}>
                    {action === "ghl_sync" ? "Sync now" : "Disconnect"}
                  </button>
                </form>
              ))}
            </div>
          </>
        )}
      </section>

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
        <h2 style={{ marginTop: 0 }}>Send us subscribers and buyers</h2>
        <p style={styles.muted}>
          Any form tool, checkout, Zapier, Make or n8n can tell us when someone opts in or buys. That is how a comment turns into a subscriber, a
          buyer and revenue. Send a <code>POST</code> with your token:
        </p>
        <table style={styles.table}>
          <tbody>
            <tr>
              <th style={styles.cell}>Subscriber</th>
              <td style={styles.cell}>
                <code style={{ wordBreak: "break-all" }}>{appBaseUrl()}/api/hooks/optin</code>
              </td>
            </tr>
            <tr>
              <th style={styles.cell}>Buyer</th>
              <td style={styles.cell}>
                <code style={{ wordBreak: "break-all" }}>{appBaseUrl()}/api/hooks/purchase</code>
              </td>
            </tr>
            <tr>
              <th style={styles.cell}>Token</th>
              <td style={styles.cell}>
                <code style={{ wordBreak: "break-all" }}>{hookToken}</code>
              </td>
            </tr>
          </tbody>
        </table>
        <p style={{ ...styles.muted, fontSize: 13 }}>
          Send the token as <code>Authorization: Bearer &lt;token&gt;</code>, as <code>X-Hook-Token</code>, or, if your tool cannot set headers, as{" "}
          <code>?token=</code> at the end of the URL. JSON and form posts both work.
          <br />
          Subscriber fields: <code>email</code> (required), <code>c2c_tid</code> (the hidden field on your form), <code>name</code>,{" "}
          <code>consent_marketing</code>. Buyer fields: <code>email</code> or <code>c2c_tid</code>, <code>external_id</code> (order id, required),{" "}
          <code>amount</code> and <code>currency</code>, <code>subscription_id</code>, <code>refunded_amount</code>. Sending the same order again is safe.
        </p>
        <form method="post" action="/api/integrations">
          <input type="hidden" name="action" value="hook_rotate" />
          <button type="submit" style={styles.secondary}>
            New token
          </button>
        </form>
        {params.hook_rotated ? <Notice tone="info">New token created. The old one no longer works; update it where you use it.</Notice> : null}
      </section>

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
