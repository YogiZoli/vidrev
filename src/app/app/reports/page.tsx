import type { ReactNode } from "react";
import { getDb } from "@/db/client";
import { formatMoney } from "@/lib/money";
import { buildHeadline, type Metrics, type Period, PERIOD_LABELS, PERIODS, type Report, type Row } from "@/lib/report";
import { requireSession } from "@/server/auth/current";
import { readSnapshots, reportLabels } from "@/server/reports";
import { Notice, styles } from "../../ui";
import { ago, HeadlineCard } from "./Headline";

export const dynamic = "force-dynamic";

const INTENT_LABELS: Record<string, string> = { hot: "HOT", warm: "WARM", cold: "COLD", "(none)": "No keyword intent" };

const COMMON_ZONES = ["UTC", "America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York", "Europe/London", "Europe/Berlin", "Europe/Budapest", "Asia/Dubai", "Asia/Kolkata", "Asia/Bangkok", "Asia/Singapore", "Asia/Manila", "Asia/Tokyo", "Australia/Sydney"];

function rate(part: number, whole: number): string {
  if (whole === 0) return "-";
  const value = (part / whole) * 100;
  return `${value < 10 ? value.toFixed(1) : Math.round(value)}%`;
}

function Table({ title, note, first, rows, currency, label }: { title: string; note?: ReactNode; first: string; rows: Row[]; currency: string; label: (row: Row) => ReactNode }) {
  return (
    <section style={styles.card}>
      <h2 style={{ marginTop: 0 }}>{title}</h2>
      {note ? <p style={styles.muted}>{note}</p> : null}
      {rows.length === 0 ? (
        <p style={styles.muted}>Nothing in this period yet.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={styles.table}>
            <thead>
              <tr>
                {[first, "Comments", "Commenters", "Replies", "Clicks", "Subscribers", "Buyers", "Revenue", "Click rate"].map((h) => (
                  <th key={h} style={styles.cell}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <td style={styles.cell}>{label(row)}</td>
                  <td style={styles.cell}>{row.comments}</td>
                  <td style={styles.cell}>{row.commenters ?? 0}</td>
                  <td style={styles.cell}>{row.replies}</td>
                  <td style={styles.cell}>{row.clicks}</td>
                  <td style={styles.cell}>{row.subscribers}</td>
                  <td style={styles.cell}>{row.buyers}</td>
                  <td style={styles.cell}>{formatMoney(row.revenueCents, currency)}</td>
                  <td style={styles.cell}>{rate(row.clicks, row.replies)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Funnel({ totals, currency }: { totals: Metrics; currency: string }) {
  const steps: [string, string, string | null][] = [
    ["Comments", String(totals.comments), null],
    ["Commenters", String(totals.commenters ?? 0), null],
    ["Replies", String(totals.replies), null],
    ["Clicks", String(totals.clicks), rate(totals.clicks, totals.replies)],
    ["Subscribers", String(totals.subscribers), rate(totals.subscribers, totals.clicks)],
    ["Buyers", String(totals.buyers), rate(totals.buyers, totals.subscribers)],
    ["Revenue", formatMoney(totals.revenueCents, currency), null],
  ];
  return (
    <section style={{ ...styles.card, display: "flex", flexWrap: "wrap", gap: 16 }}>
      {steps.map(([label, value, conversion]) => (
        <div key={label} style={{ minWidth: 90 }}>
          <div style={styles.muted}>{label}</div>
          <div style={{ fontSize: 22, fontWeight: 600 }}>{value}</div>
          {conversion ? <div style={{ ...styles.muted, fontSize: 12 }}>{conversion} of previous step</div> : null}
        </div>
      ))}
    </section>
  );
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { account, plan } = await requireSession();
  const params = await searchParams;
  const period: Period = PERIODS.includes(params.period as Period) ? (params.period as Period) : "this_month";
  const db = getDb();
  const { reports, computedAt } = await readSnapshots(db, account.id);
  const report: Report | undefined = reports[period];
  const labels = await reportLabels(db, account.id, report);
  const updated = ago(computedAt);
  const currency = report?.currency ?? account.reportingCurrency;
  const zones = COMMON_ZONES.includes(account.reportTimezone) ? COMMON_ZONES : [account.reportTimezone, ...COMMON_ZONES];

  return (
    <main style={{ ...styles.main, maxWidth: 960 }}>
      <p>
        <a href="/app">Back</a>
      </p>
      <h1>Reports</h1>
      {params.saved ? <Notice tone="info">Settings saved. The report is being recalculated.</Notice> : null}
      {params.error ? <Notice tone="error">{params.error === "timezone" ? "That time zone is not known." : "Use a 3 letter currency code such as USD."}</Notice> : null}

      {reports.this_month && reports.all_time ? (
        <HeadlineCard headline={buildHeadline(reports.this_month, reports.all_time, plan)} updated={updated} />
      ) : (
        <Notice tone="info">The first report is being calculated. It appears within a minute or two.</Notice>
      )}

      <nav style={{ display: "flex", gap: 12, flexWrap: "wrap", margin: "16px 0" }}>
        {PERIODS.map((p) =>
          p === period ? (
            <strong key={p}>{PERIOD_LABELS[p]}</strong>
          ) : (
            <a key={p} href={`/app/reports?period=${p}`}>
              {PERIOD_LABELS[p]}
            </a>
          ),
        )}
        {report ? (
          <span style={styles.muted}>
            {report.fromDay ? `${report.fromDay} to ${report.toDay}` : `until ${report.toDay}`} ({account.reportTimezone})
          </span>
        ) : null}
      </nav>

      {report ? (
        <>
          <Funnel totals={report.totals} currency={currency} />
          {report.totals.recurringCents > 0 ? <p style={styles.muted}>Recurring part: {formatMoney(report.totals.recurringCents, currency)}.</p> : null}
          {report.totals.buyersWithoutAmount > 0 ? (
            <p style={styles.muted}>
              {report.totals.buyersWithoutAmount} buyer{report.totals.buyersWithoutAmount === 1 ? "" : "s"} came from a tag or a won opportunity without an amount: counted as buyers, revenue not reported.
            </p>
          ) : null}
          {report.totals.otherCurrencies.length > 0 ? (
            <p style={styles.muted}>
              Also in other currencies (not converted): {report.totals.otherCurrencies.map((o) => formatMoney(o.revenueCents, o.currency)).join(", ")}.
            </p>
          ) : null}

          <Table
            title="By video"
            first="Video"
            rows={report.byVideo}
            currency={currency}
            label={(row) =>
              row.key === "(none)" ? (
                "No video"
              ) : (
                <a href={`https://www.youtube.com/watch?v=${encodeURIComponent(row.key)}`} target="_blank" rel="noreferrer">
                  {labels.videos.get(row.key) ?? row.key}
                </a>
              )
            }
          />
          <Table title="By keyword" first="Keyword" rows={report.byKeyword} currency={currency} label={(row) => `${row.key}${row.intent ? ` (${INTENT_LABELS[row.intent] ?? row.intent})` : ""}`} />
          <Table
            title="Reply templates"
            note="Which reply wording brings clicks and buyers. Static links are the ones in descriptions and pinned comments."
            first="Reply"
            rows={report.byTemplate}
            currency={currency}
            label={(row) => {
              const intent = row.intent ? ` (${INTENT_LABELS[row.intent] ?? row.intent})` : "";
              if (row.key === "ai") return `AI draft${intent}`;
              if (row.key === "fallback") return `Default reply${intent}`;
              if (row.key === "static") return "Static link";
              const template = labels.templates.get(row.key);
              return template ? `${template.body.slice(0, 80)}${template.body.length > 80 ? "..." : ""} [${template.language}]${intent}` : `Deleted template${intent}`;
            }}
          />
          <Table title="By keyword intent" first="Intent" rows={report.byIntent} currency={currency} label={(row) => INTENT_LABELS[row.key] ?? row.key} />
          <Table
            title="Reply speed"
            note="Replies posted in this period, grouped by the time from draft to posted reply, with every click, subscriber and buyer they led to."
            first="Time to reply"
            rows={report.byReplyTime}
            currency={currency}
            label={(row) => report.byReplyTime.find((b) => b.key === row.key)?.label ?? row.key}
          />
        </>
      ) : null}

      <section id="settings" style={styles.card}>
        <h2 style={{ marginTop: 0 }}>Report settings</h2>
        <form method="post" action="/api/reports" style={{ display: "grid", gap: 12, maxWidth: 420 }}>
          <input type="hidden" name="action" value="settings" />
          <label>
            Time zone for days and months
            <select name="timezone" defaultValue={account.reportTimezone} style={styles.input}>
              {zones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
          </label>
          <label>
            Reporting currency
            <input name="currency" defaultValue={account.reportingCurrencySource === "creator" ? account.reportingCurrency : ""} placeholder={`Automatic (now ${account.reportingCurrency})`} style={styles.input} />
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" name="weekly_email" value="1" defaultChecked={account.weeklyEmail} />
            Weekly email on Mondays: what your comments made in the last 7 days
          </label>
          <p style={{ ...styles.muted, margin: 0, fontSize: 13 }}>Leave the currency empty to follow your connected revenue source. Amounts in other currencies are listed separately, never converted.</p>
          <button type="submit" style={styles.button}>
            Save
          </button>
        </form>
      </section>
    </main>
  );
}
