import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { Facts, Meta, Page, PageHeader, SectionTitle } from "@/components/ui/page";
import { requireSession } from "@/server/auth/current";

export const dynamic = "force-dynamic";

// Settings > Account: who is signed in and the plan.
export default async function AccountSettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { user, account, plan } = await requireSession();
  const { delete_error: deleteError } = await searchParams;
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
        <Card className="grid content-start gap-3">
          <SectionTitle>Delete my account</SectionTitle>
          <Meta className="text-[15px]">
            This closes your account and deletes its data: we revoke YouTube access, delete the YouTube data, remove the Beast Mode contacts vidrev made in your CRM,
            then delete your settings, replies, links and reports. Contacts of people who opted in or bought stay in your own CRM. It starts at once, finishes within
            minutes, and cannot be undone. You get a confirmation email. A paid subscription is cancelled separately, with the manage link in your receipt email.{" "}
            <Link href="/data-deletion">What is deleted</Link>
          </Meta>
          {deleteError ? <Notice tone="error">{deleteError}</Notice> : null}
          <form method="post" action="/api/account/delete" className="grid gap-2">
            <label htmlFor="confirm_email" className="text-sm font-semibold">
              Type your account email ({user.email}) to confirm
            </label>
            <Input id="confirm_email" name="confirm_email" type="email" required autoComplete="off" />
            <div>
              <Button type="submit" variant="outline">
                Delete my account and data
              </Button>
            </div>
          </form>
        </Card>
    </Page>
  );
}
