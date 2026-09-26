import Link from "next/link";
import type { ReactNode } from "react";
import { CountUp } from "@/components/motion/CountUp";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/empty";
import { Card } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { Meta, Page, PageHeader, SectionTitle } from "@/components/ui/page";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { getDb } from "@/db/client";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/money";
import { buildHeadline, type Metrics, type Period, PERIOD_LABELS, PERIODS, type Report, type Row } from "@/lib/report";
import { requireSession } from "@/server/auth/current";
import { readSnapshots, reportLabels } from "@/server/reports";
import { Notice } from "../../ui";
import { ago, HeadlineCard } from "./Headline";

export const dynamic = "force-dynamic";

const INTENT_LABELS: Record<string, string> = { hot: "HOT", warm: "WARM", cold: "COLD", "(none)": "No keyword intent" };

const COMMON_ZONES = ["UTC", "America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York", "Europe/London", "Europe/Berlin", "Europe/Budapest", "Asia/Dubai", "Asia/Kolkata", "Asia/Bangkok", "Asia/Singapore", "Asia/Manila", "Asia/Tokyo", "Australia/Sydney"];

function rate(part: number, whole: number): string {
  if (whole === 0) return "-";
  const value = (part / whole) * 100;
  return `${value < 10 ? value.toFixed(1) : Math.round(value)}%`;
}

function ReportTable({ title, note, first, rows, currency, label }: { title: string; note?: ReactNode; first: string; rows: Row[]; currency: string; label: (row: Row) => ReactNode }) {
  return (
    <section className="grid gap-3">
      <SectionTitle>{title}</SectionTitle>
      {note ? <Meta className="text-[15px]">{note}</Meta> : null}
      {rows.length === 0 ? (
        <Meta className="text-[15px]">Nothing in this period yet.</Meta>
      ) : (
        <TableWrap>
          <Table>
            <thead>
              <tr>
                {[first, "Comments", "Commenters", "Replies", "Clicks", "Subscribers", "Buyers", "Revenue", "Click rate"].map((h, i) => (
                  <Th key={h} num={i > 0}>
                    {h}
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <Td className="min-w-[220px] max-w-[320px] font-semibold">{label(row)}</Td>
                  <Td num>{row.comments}</Td>
                  <Td num>{row.commenters ?? 0}</Td>
                  <Td num>{row.replies}</Td>
                  <Td num>{row.clicks}</Td>
                  <Td num>{row.subscribers}</Td>
                  <Td num>{row.buyers}</Td>
                  <Td num className="font-bold text-primary-700">
                    {formatMoney(row.revenueCents, currency)}
                  </Td>
                  <Td num>{rate(row.clicks, row.replies)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
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
    <Card className="grid grid-cols-[repeat(auto-fit,minmax(110px,1fr))] gap-4">
      {steps.map(([label, value, conversion]) => (
        <div key={label} className="grid content-start gap-0.5">
          <div className="text-xs font-bold uppercase tracking-[0.06em] text-label">{label}</div>
          <div className={cn("text-[22px] font-extrabold leading-tight", label === "Revenue" && "text-primary-700")}>
            {label === "Revenue" ? <CountUp value={totals.revenueCents} currency={currency} /> : <CountUp value={Number(value)} />}
          </div>
          {conversion ? <div className="text-xs text-muted-foreground">{conversion} of previous step</div> : null}
        </div>
      ))}
    </Card>
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
    <Page width="lg">
      <PageHeader title="Reports" />
      {params.saved ? <Notice tone="info">Settings saved. The report is being recalculated.</Notice> : null}
      {params.error ? <Notice tone="error">{params.error === "timezone" ? "That time zone is not known." : "Use a 3 letter currency code such as USD."}</Notice> : null}

      {reports.this_month && reports.all_time ? (
        <HeadlineCard headline={buildHeadline(reports.this_month, reports.all_time, plan)} updated={updated} />
      ) : (
        <>
          <Notice tone="info">The first report is being calculated. It appears within a minute or two.</Notice>
          <Card className="grid gap-3" aria-busy="true">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-10 w-2/3" />
            <Skeleton className="w-full" />
            <Skeleton className="w-4/5" />
          </Card>
        </>
      )}

      <nav aria-label="Period" className="flex flex-wrap items-center gap-2">
        {PERIODS.map((p) => (
          <Link
            key={p}
            href={`/app/reports?period=${p}`}
            aria-current={p === period ? "page" : undefined}
            className={cn(
              "inline-flex min-h-9 items-center rounded-full border px-3.5 text-sm font-semibold no-underline",
              p === period ? "border-secondary bg-secondary text-secondary-foreground hover:text-secondary-foreground" : "border-border-strong bg-surface text-foreground hover:bg-surface-alt hover:text-foreground",
            )}
          >
            {PERIOD_LABELS[p]}
          </Link>
        ))}
        {report ? (
          <span className="font-mono text-xs text-muted-foreground">
            {report.fromDay ? `${report.fromDay} to ${report.toDay}` : `until ${report.toDay}`} ({account.reportTimezone})
          </span>
        ) : null}
      </nav>

      {report ? (
        <>
          <Funnel totals={report.totals} currency={currency} />
          {report.totals.recurringCents > 0 ? <Meta className="text-[15px]">Recurring part: {formatMoney(report.totals.recurringCents, currency)}.</Meta> : null}
          {report.totals.buyersWithoutAmount > 0 ? (
            <Meta className="text-[15px]">
              {report.totals.buyersWithoutAmount} buyer{report.totals.buyersWithoutAmount === 1 ? "" : "s"} came from a tag or a won opportunity without an amount: counted as buyers, revenue not reported.
            </Meta>
          ) : null}
          {report.totals.otherCurrencies.length > 0 ? (
            <Meta className="text-[15px]">
              Also in other currencies (not converted): {report.totals.otherCurrencies.map((o) => formatMoney(o.revenueCents, o.currency)).join(", ")}.
            </Meta>
          ) : null}

          <ReportTable
            title="By video"
            first="Video"
            rows={report.byVideo}
            currency={currency}
            label={(row) =>
              row.key === "(none)" ? (
                "No video"
              ) : (
                <a href={`https://www.youtube.com/watch?v=${encodeURIComponent(row.key)}`} target="_blank" rel="noreferrer" className="no-underline">
                  {labels.videos.get(row.key) ?? row.key}
                </a>
              )
            }
          />
          <ReportTable title="By keyword" first="Keyword" rows={report.byKeyword} currency={currency} label={(row) => `${row.key}${row.intent ? ` (${INTENT_LABELS[row.intent] ?? row.intent})` : ""}`} />
          <ReportTable
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
          <ReportTable title="By keyword intent" first="Intent" rows={report.byIntent} currency={currency} label={(row) => INTENT_LABELS[row.key] ?? row.key} />
          <ReportTable
            title="Reply speed"
            note="Replies posted in this period, grouped by the time from draft to posted reply, with every click, subscriber and buyer they led to."
            first="Time to reply"
            rows={report.byReplyTime}
            currency={currency}
            label={(row) => report.byReplyTime.find((b) => b.key === row.key)?.label ?? row.key}
          />
        </>
      ) : null}

      <Card id="settings" className="grid gap-3">
        <SectionTitle>Report settings</SectionTitle>
        <form method="post" action="/api/reports" className="grid max-w-[420px] gap-3">
          <input type="hidden" name="action" value="settings" />
          <Field label="Time zone for days and months">
            <Select name="timezone" defaultValue={account.reportTimezone}>
              {zones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Reporting currency">
            <Input name="currency" defaultValue={account.reportingCurrencySource === "creator" ? account.reportingCurrency : ""} placeholder={`Automatic (now ${account.reportingCurrency})`} />
          </Field>
          <label className="flex items-center gap-2 text-[15px]">
            <input type="checkbox" name="weekly_email" value="1" defaultChecked={account.weeklyEmail} className="size-4 accent-[var(--primary-600)]" />
            Weekly email on Mondays: what your comments made in the last 7 days
          </label>
          <Meta>Leave the currency empty to follow your connected revenue source. Amounts in other currencies are listed separately, never converted.</Meta>
          <div>
            <Button type="submit">Save</Button>
          </div>
        </form>
      </Card>
    </Page>
  );
}
