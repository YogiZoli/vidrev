import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { PREVIEW_FINDINGS } from "@/lib/audit/score";
import { failureText, MARKETING_CONSENT_TEXT, maskEmail } from "@/lib/audit/view";
import { env } from "@/lib/env";
import { getAudit } from "@/server/audit/service";
import { Notice, styles } from "../../ui";
import { AutoRefresh } from "./AutoRefresh";

export const dynamic = "force-dynamic";

// Per-request pages are private to whoever has the link.
export const metadata: Metadata = { robots: { index: false, follow: false } };

const ERRORS: Record<string, string> = {
  invalid_email: "Enter a valid email address.",
  not_ready: "The audit is not finished yet.",
  expired: "This audit is older than 30 days and its details were deleted. Run a new one.",
  limit: "That address already received the maximum number of reports today.",
  rate: "Too many requests from your address. Please try again later.",
  server: "Something went wrong. Please try again in a moment.",
  origin: "That request did not come from this page. Please try again.",
};

export default async function AuditResultPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const query = await searchParams;
  const audit = await getAudit(getDb(), id);
  if (!audit) notFound();
  const label = audit.examples?.channelTitle ?? audit.channelInput;
  const error = query.error ? ERRORS[query.error] : null;

  if (audit.status === "queued" || audit.status === "running") {
    return (
      <main style={{ ...styles.main, maxWidth: 560 }}>
        <AutoRefresh />
        <h1>Reading {audit.channelInput}</h1>
        <p>We are reading your last videos and comments and checking the links in your descriptions. This takes a few seconds.</p>
      </main>
    );
  }

  if (audit.status === "failed" || !audit.result) {
    return (
      <main style={{ ...styles.main, maxWidth: 560 }}>
        <h1>Audit my channel</h1>
        <Notice tone="error">{failureText(audit.failureReason)}</Notice>
        <p>
          <Link href="/audit">Try another channel</Link>
        </p>
      </main>
    );
  }

  const result = audit.result;
  const preview = result.findings.slice(0, PREVIEW_FINDINGS);
  const more = result.findings.length - preview.length;
  const learnMore = env().BRAND_BASE_URL;
  const expired = Boolean(audit.apiDataScrubbedAt) || !audit.examples;

  return (
    <main style={{ ...styles.main, maxWidth: 560 }}>
      <h1>Audit of {label}</h1>
      <p style={styles.muted}>
        Based on your last {result.sample.videos} videos and {result.sample.comments} public comments. Pattern matching on real data, nothing estimated.
      </p>
      {query.sent ? (
        <Notice tone="info">
          The full report is on its way to {audit.requesterEmail ? maskEmail(audit.requesterEmail) : "your inbox"}. Check your spam folder if it does not arrive in a few minutes.
        </Notice>
      ) : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      <section style={styles.card}>
        <h2 style={{ marginTop: 0 }}>What we found</h2>
        {preview.length === 0 ? (
          <p>There was not enough in this sample to flag anything.</p>
        ) : (
          <ol style={{ paddingLeft: 20, margin: 0 }}>
            {preview.map((finding) => (
              <li key={finding.id} style={{ margin: "0 0 10px" }}>
                {finding.text}
              </li>
            ))}
          </ol>
        )}
        <p style={styles.muted}>
          {more > 0
            ? `${more === 1 ? "1 more finding is" : `${more} more findings are`} in the full report, together with your Comment Conversion Score.`
            : "Your Comment Conversion Score is in the full report."}
        </p>
      </section>

      {expired ? (
        <Notice tone="info">
          The details of this audit were deleted after 30 days (YouTube data rule). <Link href="/audit">Run a new audit</Link>.
        </Notice>
      ) : audit.reportSentAt ? (
        <p style={styles.muted}>The full report was sent to {audit.requesterEmail ? maskEmail(audit.requesterEmail) : "you"}.</p>
      ) : (
        <section style={styles.card}>
          <h2 style={{ marginTop: 0 }}>Get the full report by email</h2>
          <p style={styles.muted}>The score with its breakdown, every finding, links to the comments that need a reply, keyword candidates and the link check.</p>
          <form method="post" action="/api/audit/report" style={{ display: "grid", gap: 12 }}>
            <input type="hidden" name="audit" value={audit.id} />
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" required autoComplete="email" style={styles.input} />
            <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 14 }}>
              <input type="checkbox" name="marketing" style={{ marginTop: 3 }} />
              <span>{MARKETING_CONSENT_TEXT}</span>
            </label>
            <button type="submit" style={styles.button}>
              Email me the full report
            </button>
          </form>
          <p style={styles.muted}>The report is sent because you ask for it. Ticking the box is optional and only adds tips.</p>
        </section>
      )}

      {learnMore ? (
        <p>
          <a href={learnMore}>See how it works</a>
        </p>
      ) : null}
      <p>
        <Link href="/audit">Audit another channel</Link>
      </p>
    </main>
  );
}
