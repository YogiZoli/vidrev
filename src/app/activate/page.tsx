import { redirect } from "next/navigation";
import { Eyebrow } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { Meta, PublicCard } from "@/components/ui/page";
import { foundingCtaUrl } from "@/lib/audit/view";
import { env } from "@/lib/env";
import { TRIAL_DAYS } from "@/server/access";
import { requireSession } from "@/server/auth/current";
import { productName } from "../ui";

export const dynamic = "force-dynamic";

function Option({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-2 rounded-lg border border-border p-4">
      <h2 className="m-0 text-[17px] font-bold">{title}</h2>
      {children}
    </section>
  );
}

// A signed-up account lands here until it has access (DECISIONS A-20): a
// free trial, a coupon code, Partner access through GoHighLevel, or a plan.
// Nothing is polled, drafted or sent for a locked account.
export default async function ActivatePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { user, account } = await requireSession();
  if (account.status !== "registered") redirect("/app");
  const params = await searchParams;
  const checkout = foundingCtaUrl();
  const affiliate = env().GHL_AFFILIATE_URL;
  const trialEnded = Boolean(account.trialUsedAt);

  return (
    <PublicCard width="sm">
      <Eyebrow>{trialEnded ? "Your trial ended" : "Almost there"}</Eyebrow>
      <h1 className="m-0 text-[28px] font-bold leading-tight tracking-[-0.016em]">Activate {productName()}</h1>
      {params.error ? <Notice tone="error">{params.error}</Notice> : null}
      {params.ghl_connected ? (
        <Notice tone="info">GoHighLevel is connected. If it came from our partner link with the vidrev snapshot, your free access turns on within a minute: reload this page.</Notice>
      ) : null}

      {!trialEnded ? (
        <Option title={`Try it free for ${TRIAL_DAYS} days`}>
          <Meta className="text-[15px]">Everything included. No card needed. When it ends, choose a plan to keep going.</Meta>
          <form method="post" action="/api/access">
            <input type="hidden" name="kind" value="trial" />
            <Button type="submit" size="lg" pulse className="w-full">
              Start my free trial
            </Button>
          </form>
        </Option>
      ) : null}

      <Option title="Free with GoHighLevel">
        <Meta className="text-[15px]">
          Join GoHighLevel through our partner link and {productName()} is free for as long as you stay a GoHighLevel customer. Already joined through our link? Connect it
          and we unlock your access.
        </Meta>
        <div className="flex flex-wrap gap-2">
          {affiliate ? (
            <a href={affiliate} target="_blank" rel="noopener sponsored" className={buttonVariants({ variant: "outline" })}>
              Start GoHighLevel free
            </a>
          ) : null}
          <a href="/api/oauth/crm/start" className={buttonVariants({ variant: "outline" })}>
            Connect my GoHighLevel
          </a>
        </div>
        {affiliate ? <Meta className="text-[13px]">Partner link: we may earn a commission from GoHighLevel, at no cost to you.</Meta> : null}
      </Option>

      <Option title="Have a code?">
        <form method="post" action="/api/access" className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="kind" value="coupon" />
          <div className="grid flex-1 gap-1">
            <Label htmlFor="code">Code</Label>
            <Input id="code" name="code" required autoComplete="off" className="uppercase" />
          </div>
          <Button type="submit" variant="outline">
            Apply
          </Button>
        </form>
      </Option>

      {checkout ? (
        <Option title="Founding 100: $97 a year">
          <Meta className="text-[15px]">Price locked for life. 14 day money-back guarantee. At checkout use {user.email}, so the plan lands on this account.</Meta>
          <a href={checkout} className={buttonVariants({ size: "lg" })}>
            Claim a founding seat
          </a>
        </Option>
      ) : null}

      <form method="post" action="/api/auth/logout">
        <button type="submit" className={buttonVariants({ variant: "ghost" })}>
          Sign out
        </button>
      </form>
    </PublicCard>
  );
}
