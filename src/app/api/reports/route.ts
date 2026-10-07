import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { accounts } from "@/db/schema";
import { enqueue } from "@/jobs/enqueue";
import { QUEUES } from "@/jobs/queues";
import { normalizeCurrency } from "@/lib/money";
import { isValidTimeZone } from "@/lib/time";
import { markReportDirty } from "@/server/attribution";
import { currentSession } from "@/server/auth/current";
import { isSameOrigin, redirectTo } from "@/server/http";
import { guarded } from "@/server/route-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Form posts from /app/reports. The worker rebuilds the snapshots.
async function postHandler(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const session = await currentSession();
  if (!session) return redirectTo("/login");
  const form = await request.formData();
  const field = (name: string) => String(form.get(name) ?? "").trim();
  if (field("action") !== "settings") return redirectTo("/app/reports");

  const timezone = field("timezone") || "UTC";
  if (!isValidTimeZone(timezone)) return redirectTo("/app/reports?error=timezone");
  const currencyInput = field("currency");
  const currency = currencyInput ? normalizeCurrency(currencyInput) : null;
  if (currencyInput && !currency) return redirectTo("/app/reports?error=currency");

  const db = getDb();
  const accountId = session.account.id;
  await db
    .update(accounts)
    .set({
      reportTimezone: timezone,
      weeklyEmail: field("weekly_email") === "1",
      // Empty means automatic (Q-08): the worker follows the revenue source.
      ...(currency ? { reportingCurrency: currency, reportingCurrencySource: "creator" as const } : { reportingCurrencySource: "default" as const }),
      updatedAt: new Date(),
    })
    .where(eq(accounts.id, accountId));
  await markReportDirty(db, accountId);
  await enqueue(QUEUES.reportRefresh, { accountId }, { singletonKey: accountId });
  return redirectTo("/app/reports?saved=1");
}

export const POST = guarded("/api/reports", postHandler);
