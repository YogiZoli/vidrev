import { and, count, eq, gt } from "drizzle-orm";
import type { Db } from "@/db/client";
import { audits } from "@/db/schema";
import type { SendEmailJob } from "@/jobs/queues";
import { isValidEmail, normalizeEmail } from "@/lib/email";
import { appBaseUrl, env } from "@/lib/env";
import { auditReportEmail } from "@/server/email/templates";
import type { FetchLike } from "@/server/google/oauth";
import { getAudit } from "./service";

// The full report goes to the address the visitor typed (DECISIONS P9-10). The
// email itself is the gate; marketing consent is a separate, never pre-checked
// box whose answer is stored with its time (D-08).

export const REPORTS_PER_EMAIL_PER_DAY = 3;

export type ReportRequest =
  | { ok: true; alreadySent: boolean; email: SendEmailJob | null }
  | { ok: false; error: "invalid_email" | "not_ready" | "expired" | "limit" | "not_found" };

export async function requestReport(
  db: Db,
  input: { auditId: string; email: string; marketing: boolean },
  now = new Date(),
): Promise<ReportRequest> {
  const audit = await getAudit(db, input.auditId);
  if (!audit) return { ok: false, error: "not_found" };
  if (audit.status !== "done" || !audit.result) return { ok: false, error: "not_ready" };
  if (audit.reportSentAt) return { ok: true, alreadySent: true, email: null };
  if (audit.apiDataScrubbedAt || !audit.examples) return { ok: false, error: "expired" };
  if (!isValidEmail(input.email)) return { ok: false, error: "invalid_email" };
  const email = normalizeEmail(input.email);

  const [{ sent }] = await db
    .select({ sent: count() })
    .from(audits)
    .where(and(eq(audits.requesterEmail, email), gt(audits.reportSentAt, new Date(now.getTime() - 86_400_000))));
  if ((sent ?? 0) >= REPORTS_PER_EMAIL_PER_DAY) return { ok: false, error: "limit" };

  // Claim the audit: a double submit sends one report.
  const [claimed] = await db
    .update(audits)
    .set({ requesterEmail: email, consentMarketing: input.marketing, consentAt: now, reportSentAt: now })
    .where(and(eq(audits.id, audit.id), eq(audits.status, "done")))
    .returning({ id: audits.id });
  if (!claimed) return { ok: true, alreadySent: true, email: null };

  const brand = env().BRAND_BASE_URL;
  let learnMoreUrl: string | null = null;
  if (brand) {
    const url = new URL(brand);
    url.searchParams.set("utm_source", "audit");
    url.searchParams.set("utm_medium", "email");
    url.searchParams.set("utm_campaign", audit.result.stack.segment);
    learnMoreUrl = url.toString();
  }
  return {
    ok: true,
    alreadySent: false,
    email: auditReportEmail({
      to: email,
      productName: env().PRODUCT_NAME,
      auditUrl: `${appBaseUrl()}/audit/${audit.id}`,
      learnMoreUrl,
      channelLabel: audit.examples.channelTitle ?? audit.channelInput,
      auditedAt: audit.fetchedAt ?? audit.createdAt,
      result: audit.result,
      examples: audit.examples,
    }),
  };
}

// Cloudflare Turnstile (SPEC-REVIEW R-16), enforced only when both keys are
// set. One short call in the request path; the audit itself still runs in the
// worker. Fails closed when the check cannot be made.
export async function verifyTurnstile(secret: string, token: string | null, ip: string, fetchImpl: FetchLike = fetch): Promise<boolean> {
  if (!token) return false;
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip !== "unknown") body.set("remoteip", ip);
    const response = await fetchImpl("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
      signal: AbortSignal.timeout(4_000),
    });
    return ((await response.json()) as { success?: boolean }).success === true;
  } catch {
    return false;
  }
}
