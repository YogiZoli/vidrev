import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { audits } from "@/db/schema";
import { enqueue } from "@/jobs/enqueue";
import { QUEUES } from "@/jobs/queues";
import { errorFields, log } from "@/lib/log";
import { RateLimiter } from "@/lib/ratelimit";
import { requestReport } from "@/server/audit/report";
import { isSameOrigin, redirectTo } from "@/server/http";
import { clientIp } from "@/server/integrations/inbound-http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// "Send me the full report" (DECISIONS P9-10): 10 requests an hour per address
// on top of the per-email daily limit.
const reportLimit = new RateLimiter(10, 3_600_000);

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return redirectTo("/audit?error=origin");
  const form = await request.formData().catch(() => null);
  const auditId = String(form?.get("audit") ?? "");
  const back = (query: string) => redirectTo(`/audit/${encodeURIComponent(auditId)}?${query}`);
  if (reportLimit.hit(`ip:${clientIp(request.headers)}`) > 0) return back("error=rate");

  const db = getDb();
  try {
    const result = await requestReport(db, {
      auditId,
      email: String(form?.get("email") ?? ""),
      marketing: form?.get("marketing") === "on",
    });
    if (!result.ok) return back(`error=${result.error}`);
    if (result.email) {
      try {
        await enqueue(QUEUES.sendEmail, result.email);
      } catch (error) {
        // Nothing was sent: release the claim so the visitor can try again.
        await db.update(audits).set({ reportSentAt: null }).where(eq(audits.id, auditId));
        throw error;
      }
      // The lead for the owner's CRM; the report is already on its way, so a
      // failure here must not fail the visitor's request.
      await enqueue(QUEUES.auditLead, { auditId }).catch((error: unknown) => log("error", "audit lead enqueue failed", errorFields(error)));
    }
    return back("sent=1");
  } catch (error) {
    log("error", "audit report failed", errorFields(error));
    return back("error=server");
  }
}
