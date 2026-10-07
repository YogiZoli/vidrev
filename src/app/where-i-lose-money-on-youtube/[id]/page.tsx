import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AuditResultV2 } from "@/components/audit/AuditResultV2";
import { Eyebrow } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { Meta, PublicCard, SectionTitle } from "@/components/ui/page";
import { getDb } from "@/db/client";
import {
  failureText,
  foundingCtaUrl,
  MARKETING_CONSENT_TEXT,
  maskEmail,
} from "@/lib/audit/view";
import { getAudit } from "@/server/audit/service";
import { Notice } from "../../ui";
import { AutoRefresh } from "./AutoRefresh";

export const dynamic = "force-dynamic";

// Per-request pages are private to whoever has the link.
export const metadata: Metadata = { robots: { index: false, follow: false } };

const ERRORS: Record<string, string> = {
  invalid_email: "Enter a valid email address.",
  not_ready: "The audit is not finished yet.",
  expired:
    "This audit is older than 30 days and its details were deleted. Run a new one.",
  limit: "That address already received the maximum number of reports today.",
  rate: "Too many requests from your address. Please try again later.",
  server: "Something went wrong. Please try again in a moment.",
  origin: "That request did not come from this page. Please try again.",
};

const H1 = "m-0 text-[28px] font-bold leading-tight tracking-[-0.016em]";

export default async function AuditResultPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const audit = await getAudit(getDb(), id);
  if (!audit) notFound();
  const label = audit.examples?.channelTitle ?? audit.channelInput;
  const error = query.error ? ERRORS[query.error] : null;

  if (audit.status === "queued" || audit.status === "running") {
    return (
      <PublicCard width="md">
        <AutoRefresh />
        <Eyebrow>Reading</Eyebrow>
        <h1 className={H1}>Reading {audit.channelInput}</h1>
        <div aria-hidden className="grid gap-2">
          <div className="skeleton h-4 w-full" />
          <div className="skeleton h-4 w-4/5" />
          <div className="skeleton h-4 w-3/5" />
        </div>
        <p className="m-0 text-base text-ink-2">
          We are reading your last videos and comments and checking the links in
          your descriptions. This takes a few seconds.
        </p>
      </PublicCard>
    );
  }

  if (audit.status === "failed" || !audit.result) {
    return (
      <PublicCard width="md">
        <h1 className={H1}>See where I lose money on YouTube</h1>
        <Notice tone="error">{failureText(audit.failureReason)}</Notice>
        <Button asChild pulse>
          <Link href="/where-i-lose-money-on-youtube">Try another channel</Link>
        </Button>
      </PublicCard>
    );
  }

  const result = audit.result;
  const expired = Boolean(audit.apiDataScrubbedAt) || !audit.examples;
  const emailSlot = expired ? (
    <Notice tone="info">
      The details of this audit were deleted after 30 days (YouTube data rule).{" "}
      <Link href="/where-i-lose-money-on-youtube">Run a new audit</Link>.
    </Notice>
  ) : audit.reportSentAt ? (
    <Meta className="text-[15px]">
      The full report was sent to{" "}
      {audit.requesterEmail ? maskEmail(audit.requesterEmail) : "you"}.
    </Meta>
  ) : (
    <Card className="grid gap-3">
      <SectionTitle>Get the full list by email</SectionTitle>
      <Meta className="text-[15px]">
        Every comment that needs a reply, every keyword candidate and the full
        link check.
      </Meta>
      <form method="post" action="/api/audit/report" className="grid gap-3">
        <input type="hidden" name="audit" value={audit.id} />
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          large
        />
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="marketing"
            className="mt-1 size-4 accent-[var(--primary-600)]"
          />
          <span>{MARKETING_CONSENT_TEXT}</span>
        </label>
        <Button type="submit" size="lg">
          Email me the full list
        </Button>
      </form>
      <Meta>
        The report is sent because you ask for it. Ticking the box is optional
        and only adds tips.
      </Meta>
    </Card>
  );

  return (
    <main className="mx-auto grid max-w-[1180px] gap-5 px-4 pb-16 pt-4">
      {query.sent ? (
        <Notice tone="info">
          The full report is on its way to{" "}
          {audit.requesterEmail
            ? maskEmail(audit.requesterEmail)
            : "your inbox"}
          . Check your spam folder if it does not arrive in a few minutes.
        </Notice>
      ) : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      <AuditResultV2
        channelLabel={label}
        result={result}
        examples={expired ? null : audit.examples}
        ctaUrl={foundingCtaUrl()}
        emailSlot={emailSlot}
      />
      <p className="m-0 flex flex-wrap gap-4 text-[15px]">
        <Link href="/where-i-lose-money-on-youtube">Check another channel</Link>
      </p>
    </main>
  );
}
