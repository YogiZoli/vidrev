import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Facts, Page, PageHeader, SectionTitle } from "@/components/ui/page";
import { requireSession } from "@/server/auth/current";

export const dynamic = "force-dynamic";

// Settings > Account: who is signed in and the plan.
export default async function AccountSettingsPage() {
  const { user, account, plan } = await requireSession();
  return (
    <Page width="md">
      <PageHeader title="Account" />
        <Card className="grid content-start gap-3">
          <div className="flex items-center justify-between gap-2">
            <SectionTitle>Account</SectionTitle>
            <Badge tone="primary" className="uppercase tracking-wide">
              {plan.label}
            </Badge>
          </div>
          <Facts
            items={[
              ["Email", user.email],
              ["Plan", `${plan.label}${plan.priceLabel ? ` (${plan.priceLabel})` : ""}${account.trialEndsAt ? `, trial ends ${account.trialEndsAt.toISOString().slice(0, 10)}` : ""}`],
              ["Replies", `${plan.monthlyReplyCap ?? "no plan limit"} per month, at most ${plan.dailyReplyCap ?? "unlimited"} per day`],
            ]}
          />
          <div className="flex flex-wrap gap-4 text-sm">
            {plan.billing === "monthly" || plan.billing === "annual" ? (
              <Link href="/app/settings/billing" className="text-muted-foreground">
                Billing and cancel
              </Link>
            ) : null}
          </div>
        </Card>
    </Page>
  );
}
