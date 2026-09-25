import { formatMoney } from "@/lib/money";
import type { Headline } from "@/lib/report";
import { styles } from "../../ui";

// Report headline (DECISIONS Q-09, R-35): this month and lifetime attributed
// revenue, the recurring part, and the subscription as a share of it.
export function HeadlineCard({ headline, updated }: { headline: Headline; updated: string | null }) {
  const money = (cents: number) => formatMoney(cents, headline.currency);
  return (
    <section style={styles.card}>
      <p style={{ fontSize: 22, margin: "0 0 8px" }}>
        This month your comments made <strong>{money(headline.thisMonthCents)}</strong>.
      </p>
      <p style={{ margin: "0 0 8px" }}>
        Lifetime: <strong>{money(headline.lifetimeCents)}</strong>
        {headline.recurringLifetimeCents > 0 ? (
          <>
            , of which {money(headline.recurringLifetimeCents)} recurring ({money(headline.recurringThisMonthCents)} this month)
          </>
        ) : null}
        .
      </p>
      {headline.subscriptionPercent !== null && headline.subscriptionMonthlyCents !== null ? (
        <p style={{ margin: "0 0 8px" }}>
          Your subscription ({money(headline.subscriptionMonthlyCents)} a month) cost {percent(headline.subscriptionPercent)} of what your comments made this month
          {headline.roiMultiple !== null ? `: your comments made ${multiple(headline.roiMultiple)} your subscription` : ""}.
        </p>
      ) : null}
      <p style={{ ...styles.muted, margin: 0, fontSize: 13 }}>
        Only real, attributed purchases: the last comment link or opt-in within 180 days before the sale; refunds are subtracted.
        {updated ? ` Updated ${updated}.` : " Calculating the first report."}
      </p>
    </section>
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
