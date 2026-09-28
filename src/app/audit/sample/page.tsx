import type { Metadata } from "next";
import Link from "next/link";
import { Eyebrow } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Meta, PublicCard, SectionTitle } from "@/components/ui/page";
import { sampleAudit } from "@/lib/audit/sample";
import { PREVIEW_FINDINGS } from "@/lib/audit/score";
import { env } from "@/lib/env";
import { auditReportEmail } from "@/server/email/templates";

export const metadata: Metadata = { title: "Sample audit", robots: { index: false, follow: false } };

const H1 = "m-0 text-[28px] font-bold leading-tight tracking-[-0.016em]";

// What an audit looks like, on an invented channel: the on-page preview and
// the full report email, both rendered by the real code.
export default function SampleAuditPage() {
  const { channelTitle, result, examples } = sampleAudit();
  const preview = result.findings.slice(0, PREVIEW_FINDINGS);
  const report = auditReportEmail({
    to: "you@example.com",
    productName: env().PRODUCT_NAME,
    auditUrl: "/audit/sample",
    learnMoreUrl: env().BRAND_BASE_URL ?? null,
    channelLabel: channelTitle,
    auditedAt: new Date(),
    result,
    examples,
  });
  return (
    <PublicCard width="md">
      <Eyebrow>Sample audit</Eyebrow>
      <h1 className={H1}>Audit of {channelTitle}</h1>
      <Meta className="text-[15px]">
        Invented channel, real analysis: {result.sample.videos} videos and {result.sample.comments} comments.
      </Meta>
      <Card className="grid gap-3">
        <SectionTitle>What we found</SectionTitle>
        <ol className="m-0 grid gap-2.5 pl-5 text-base">
          {preview.map((finding) => (
            <li key={finding.id}>{finding.text}</li>
          ))}
        </ol>
      </Card>
      <Card className="grid gap-3">
        <SectionTitle>The full report (sent by email)</SectionTitle>
        <iframe title="Full report" srcDoc={report.html} className="h-[1400px] w-full rounded border-0 bg-white" />
      </Card>
      <Button asChild pulse>
        <Link href="/audit">Audit my channel</Link>
      </Button>
    </PublicCard>
  );
}
