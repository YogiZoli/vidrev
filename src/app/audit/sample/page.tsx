import type { Metadata } from "next";
import { AuditResultV2 } from "@/components/audit/AuditResultV2";
import { Card } from "@/components/ui/card";
import { SectionTitle } from "@/components/ui/page";
import { sampleAudit } from "@/lib/audit/sample";
import { foundingCtaUrl } from "@/lib/audit/view";
import { env } from "@/lib/env";
import { auditReportEmail } from "@/server/email/templates";

export const metadata: Metadata = {
  title: "Sample: See where I lose money on YouTube",
  robots: { index: false, follow: false },
};

// What the audit looks like on an invented channel: the result page and the
// full report email, both rendered by the real code.
export default function SampleAuditPage() {
  const { channelTitle, result, examples } = sampleAudit();
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
    <main className="mx-auto grid max-w-[1180px] gap-5 px-4 pb-16 pt-4">
      <AuditResultV2
        channelLabel={channelTitle}
        result={result}
        examples={examples}
        ctaUrl={foundingCtaUrl()}
        eyebrow="Sample: See where I lose money on YouTube"
        emailSlot={
          <Card className="grid gap-3">
            <SectionTitle>The full list (sent by email)</SectionTitle>
            <iframe
              title="Full report"
              srcDoc={report.html}
              className="h-[1400px] w-full rounded border-0 bg-white"
            />
          </Card>
        }
      />
    </main>
  );
}
