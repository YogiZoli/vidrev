import { getDb } from "@/db/client";
import { env } from "@/lib/env";
import { formatMoney } from "@/lib/money";
import { requireSession } from "@/server/auth/current";
import { readSnapshots } from "@/server/reports";
import { styles } from "../../ui";

export const dynamic = "force-dynamic";

// Before cancelling (R-35 anti-churn): what the comments made, and what stops.
// Billing lives in the checkout (B-04), so cancelling happens there.
export default async function CancelPage() {
  const { account } = await requireSession();
  const { reports } = await readSnapshots(getDb(), account.id);
  const all = reports.all_time;
  const month = reports.this_month;
  const portal = env().BILLING_PORTAL_URL;

  return (
    <main style={styles.main}>
      <p>
        <a href="/app">Back</a>
      </p>
      <h1>Before you cancel</h1>
      <section style={styles.card}>
        {all ? (
          <>
            <p style={{ fontSize: 20, marginTop: 0 }}>
              Your comments made <strong>{formatMoney(all.totals.revenueCents, all.currency)}</strong> since you started
              {month ? `, ${formatMoney(month.totals.revenueCents, month.currency)} of it this month` : ""}.
            </p>
            <p>
              {all.totals.clicks} clicks, {all.totals.subscribers} subscribers and {all.totals.buyers} buyers were traced back to your comment replies.
            </p>
          </>
        ) : (
          <p style={{ marginTop: 0 }}>Your first report is still being calculated.</p>
        )}
      </section>
      <section style={styles.card}>
        <h2 style={{ marginTop: 0 }}>What happens when you cancel</h2>
        <ul>
          <li>Every link you already posted keeps working and keeps sending viewers to your page. We never hold your links hostage.</li>
          <li>Measurement stops: new clicks, subscribers and buyers are no longer counted or attributed.</li>
          <li>No new comments are read and no replies are drafted or posted.</li>
          <li>You can still sign in and see the reports recorded so far.</li>
        </ul>
      </section>
      <section style={styles.card}>
        {portal ? (
          <p style={{ margin: 0 }}>
            <a href={portal} style={styles.secondary}>
              Manage or cancel my subscription
            </a>
          </p>
        ) : (
          <p style={{ margin: 0 }}>To cancel, use the manage link in your purchase receipt email, or reply to any email from us and we cancel it for you.</p>
        )}
      </section>
    </main>
  );
}
