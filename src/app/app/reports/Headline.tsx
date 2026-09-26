import type { ReactNode } from "react";
import { Badge, Eyebrow } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Meta } from "@/components/ui/page";
import { formatMoney } from "@/lib/money";
import type { Headline } from "@/lib/report";

// Report headline (DECISIONS Q-09, R-35): this month and lifetime attributed
// revenue, the recurring part, and the subscription as a share of it.
export function HeadlineCard({ headline, updated, children }: { headline: Headline; updated: string | null; children?: ReactNode }) {
  const money = (cents: number) => formatMoney(cents, headline.currency);
  return (
    <Card variant="hero" className="grid gap-4 p-6">
      <Eyebrow>This month</Eyebrow>
      <h2 className="m-0 text-[30px] font-bold leading-tight tracking-[-0.018em]">
        This month your comments made{" "}
        <span className="mt-1.5 block text-[44px] font-extrabold leading-none tracking-[-0.035em] text-primary-700 md:text-[56px]">{money(headline.thisMonthCents)}</span>
      </h2>
      <p className="m-0 text-base text-ink-2">
        Lifetime: <strong>{money(headline.lifetimeCents)}</strong>
        {headline.recurringLifetimeCents > 0 ? (
          <>
            , of which {money(headline.recurringLifetimeCents)} recurring ({money(headline.recurringThisMonthCents)} this month)
          </>
        ) : null}
        .
      </p>
      {headline.subscriptionPercent !== null && headline.subscriptionMonthlyCents !== null ? (
        <div className="flex flex-wrap items-center gap-2.5">
          {headline.roiMultiple !== null ? <Badge tone="success" className="text-sm">{multiple(headline.roiMultiple)} your subscription</Badge> : null}
          <span className="text-[15px] text-label">
            Your subscription ({money(headline.subscriptionMonthlyCents)} a month) cost {percent(headline.subscriptionPercent)} of what your comments made this month.
          </span>
        </div>
      ) : null}
      <Meta>
        Only real, attributed purchases: the last comment link or opt-in within 180 days before the sale; refunds are subtracted.
        {updated ? ` Updated ${updated}.` : " Calculating the first report."}
      </Meta>
      {children}
    </Card>
  );
}

function percent(value: number): string {
  return `${value < 1 ? value.toFixed(2) : value < 10 ? value.toFixed(1) : Math.round(value)}%`;
}

function multiple(value: number): string {
  return `${value < 10 ? value.toFixed(1) : Math.round(value)}x`;
}

export function ago(date: Date | null, now = new Date()): string | null {
  if (!date) return null;
  const minutes = Math.max(0, Math.round((now.getTime() - date.getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : date.toISOString().slice(0, 10);
}
