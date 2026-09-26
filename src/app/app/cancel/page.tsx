import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Page, PageHeader, SectionTitle } from "@/components/ui/page";
import { getDb } from "@/db/client";
import { env } from "@/lib/env";
import { formatMoney } from "@/lib/money";
import { requireSession } from "@/server/auth/current";
import { readSnapshots } from "@/server/reports";

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
    <Page width="md">
      <PageHeader title="Before you cancel" />
      <Card variant="hero" className="grid gap-2">
        {all ? (
          <>
            <p className="m-0 text-xl">
              Your comments made <strong className="text-primary-700">{formatMoney(all.totals.revenueCents, all.currency)}</strong> since you started
              {month ? `, ${formatMoney(month.totals.revenueCents, month.currency)} of it this month` : ""}.
            </p>
            <p className="m-0 text-base text-ink-2">
              {all.totals.clicks} clicks, {all.totals.subscribers} subscribers and {all.totals.buyers} buyers were traced back to your comment replies.
            </p>
          </>
        ) : (
          <p className="m-0">Your first report is still being calculated.</p>
        )}
      </Card>
      <Card className="grid gap-3">
        <SectionTitle>What happens when you cancel</SectionTitle>
        <ul className="m-0 grid gap-2 pl-5 text-[15px] text-ink-2">
          <li>Every link you already posted keeps working and keeps sending viewers to your page. We never hold your links hostage.</li>
          <li>Measurement stops: new clicks, subscribers and buyers are no longer counted or attributed.</li>
          <li>No new comments are read and no replies are drafted or posted.</li>
          <li>You can still sign in and see the reports recorded so far.</li>
        </ul>
      </Card>
      <Card>
        {portal ? (
          <Button asChild variant="outline">
            <a href={portal}>Manage or cancel my subscription</a>
          </Button>
        ) : (
          <p className="m-0 text-[15px]">To cancel, use the manage link in your purchase receipt email, or reply to any email from us and we cancel it for you.</p>
        )}
      </Card>
    </Page>
  );
}
