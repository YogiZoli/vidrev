import { getDb } from "@/db/client";
import { env } from "@/lib/env";
import { auditOverview, listAccountsForAdmin, listPlans } from "@/server/admin";
import { requireAdmin } from "@/server/auth/current";
import { auditUnitsLeft } from "@/server/quota";
import { Notice, styles } from "../ui";

export const dynamic = "force-dynamic";

// Owner console (DECISIONS Q-21), limited to ADMIN_EMAILS.
export default async function AdminPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdmin();
  const { msg } = await searchParams;
  const db = getDb();
  const auditLimit = env().AUDIT_DAILY_LIMIT;
  const [accountRows, planRows, audit, auditLeft] = await Promise.all([listAccountsForAdmin(db), listPlans(db), auditOverview(db), auditUnitsLeft(db, auditLimit)]);
  const founding = accountRows.filter((a) => a.planCode === "founding").length;
  const foundingCap = planRows.find((p) => p.code === "founding")?.seatsCap ?? 100;

  const planSelect = (name: string, selected?: string) => (
    <select name={name} defaultValue={selected} style={{ ...styles.input, width: "auto" }}>
      {planRows.map((p) => (
        <option key={p.code} value={p.code}>
          {p.code}
        </option>
      ))}
    </select>
  );

  return (
    <main style={{ ...styles.main, maxWidth: 1000 }}>
      <p>
        <a href="/app">Back to app</a>
      </p>
      <h1>Owner admin</h1>
      {msg ? <Notice tone="info">{msg}</Notice> : null}

      <section style={styles.card}>
        <h2 style={{ marginTop: 0 }}>Grant access</h2>
        <p style={styles.muted}>Creates the account (or updates its plan) and emails a sign-in link. Use it for partner access (ghl_affiliate_free).</p>
        <form method="post" action="/api/admin" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input type="hidden" name="kind" value="grant" />
          <input name="email" type="email" required placeholder="email" style={{ ...styles.input, width: 280 }} />
          {planSelect("planCode", "ghl_affiliate_free")}
          <button type="submit" style={styles.button}>
            Grant
          </button>
        </form>
      </section>

      <section style={styles.card}>
        <h2 style={{ marginTop: 0 }}>Accounts</h2>
        <p style={styles.muted}>
          Founding seats: {founding} of {foundingCap}. Total accounts: {accountRows.length}.
        </p>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.cell}>Email</th>
              <th style={styles.cell}>Status</th>
              <th style={styles.cell}>Plan</th>
              <th style={styles.cell}>Channels</th>
              <th style={styles.cell}>Created</th>
              <th style={styles.cell}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {accountRows.map((a) => (
              <tr key={a.accountId}>
                <td style={styles.cell}>{a.email}</td>
                <td style={styles.cell}>
                  {a.status}
                  {a.trialEndsAt ? ` (trial to ${a.trialEndsAt.toISOString().slice(0, 10)})` : ""}
                </td>
                <td style={styles.cell}>
                  <form method="post" action="/api/admin" style={{ display: "flex", gap: 6 }}>
                    <input type="hidden" name="kind" value="set_plan" />
                    <input type="hidden" name="accountId" value={a.accountId} />
                    {planSelect("planCode", a.planCode)}
                    <button type="submit" style={styles.secondary}>
                      Save
                    </button>
                  </form>
                </td>
                <td style={styles.cell}>{a.liveChannels}</td>
                <td style={styles.cell}>{a.createdAt.toISOString().slice(0, 10)}</td>
                <td style={styles.cell}>
                  <form method="post" action="/api/admin">
                    <input type="hidden" name="kind" value={a.status === "active" ? "suspend" : "unsuspend"} />
                    <input type="hidden" name="accountId" value={a.accountId} />
                    <button type="submit" style={styles.secondary}>
                      {a.status === "active" ? "Suspend" : "Reactivate"}
                    </button>
                  </form>
                  <form method="post" action="/api/admin" style={{ marginTop: 6 }}>
                    <input type="hidden" name="kind" value={a.fallbackLinksBlocked ? "unblock_links" : "block_links"} />
                    <input type="hidden" name="accountId" value={a.accountId} />
                    <button type="submit" style={styles.secondary}>
                      {a.fallbackLinksBlocked ? "Allow fallback links" : "Block fallback links"}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section style={styles.card}>
        <h2 style={{ marginTop: 0 }}>Audit my channel</h2>
        <p style={styles.muted}>
          Last 7 days: {audit.requests} audits requested, {audit.done} finished, {audit.reports} full reports requested. Audit quota today: {auditLimit - auditLeft} of {auditLimit} units used.
        </p>
        {audit.recent.length === 0 ? (
          <p style={styles.muted}>No report requests yet.</p>
        ) : (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.cell}>Email</th>
                <th style={styles.cell}>Channel</th>
                <th style={styles.cell}>Score</th>
                <th style={styles.cell}>Stack</th>
                <th style={styles.cell}>Marketing consent</th>
                <th style={styles.cell}>Requested</th>
              </tr>
            </thead>
            <tbody>
              {audit.recent.map((r, i) => (
                <tr key={`${r.email}-${i}`}>
                  <td style={styles.cell}>{r.email}</td>
                  <td style={styles.cell}>{r.channel}</td>
                  <td style={styles.cell}>{r.score ?? "-"}</td>
                  <td style={styles.cell}>{r.segment ?? "-"}</td>
                  <td style={styles.cell}>{r.marketing ? "yes" : "no"}</td>
                  <td style={styles.cell}>{r.at ? r.at.toISOString().slice(0, 16).replace("T", " ") : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
