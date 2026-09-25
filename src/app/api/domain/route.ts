import { getDb } from "@/db/client";
import { enqueue } from "@/jobs/enqueue";
import { QUEUES } from "@/jobs/queues";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { currentSession } from "@/server/auth/current";
import { addDomain, removeDomain, reservedDomains, restartDomainCheck } from "@/server/domains/service";
import { isSameOrigin, redirectTo } from "@/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Form posts from /app/domain. DNS and Cloudflare calls happen in the worker.
export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const session = await currentSession();
  if (!session) return redirectTo("/login");
  const form = await request.formData();
  const field = (name: string) => String(form.get(name) ?? "");
  const accountId = session.account.id;
  const db = getDb();
  const { APP_BASE_URL, BRAND_BASE_URL, LINK_FALLBACK_BASE_URL, CUSTOM_HOSTNAME_LIMIT, ADMIN_EMAILS } = env();

  switch (field("action")) {
    case "add": {
      const result = await addDomain(db, accountId, field("hostname"), reservedDomains([APP_BASE_URL, BRAND_BASE_URL, LINK_FALLBACK_BASE_URL]), CUSTOM_HOSTNAME_LIMIT);
      if (!result.ok) {
        if (result.capReached) {
          log("warn", "custom hostname cap reached", { limit: CUSTOM_HOSTNAME_LIMIT });
          for (const to of (ADMIN_EMAILS ?? "").split(",").map((e) => e.trim()).filter(Boolean)) {
            const text = `A creator tried to add a link domain, but the cap of ${CUSTOM_HOSTNAME_LIMIT} custom hostnames is reached. Raise CUSTOM_HOSTNAME_LIMIT on Railway (each hostname above 100 costs 0.10 USD a month).
Account: ${accountId}`;
            await enqueue(QUEUES.sendEmail, { to, subject: "Custom hostname cap reached", text, html: `<p>${text}</p>` });
          }
        }
        return redirectTo(`/app/domain?error=${encodeURIComponent(result.error)}`);
      }
      await enqueue(QUEUES.domainCheck, { domainId: result.id }, { singletonKey: result.id });
      return redirectTo("/app/domain?added=1");
    }
    case "check": {
      const id = field("domainId");
      if (await restartDomainCheck(db, accountId, id)) await enqueue(QUEUES.domainCheck, { domainId: id }, { singletonKey: id });
      return redirectTo("/app/domain?checking=1");
    }
    case "remove": {
      const id = field("domainId");
      if (await removeDomain(db, accountId, id)) await enqueue(QUEUES.domainRemove, { domainId: id });
      return redirectTo("/app/domain?removed=1");
    }
    default:
      return redirectTo("/app/domain");
  }
}
