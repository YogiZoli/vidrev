import { getDb } from "@/db/client";
import { appBaseUrl, domainConnectConfig } from "@/lib/env";
import { cookieDomain } from "@/lib/links";
import { currentSession } from "@/server/auth/current";
import { applyUrl } from "@/server/domains/domain-connect";
import { liveDomain } from "@/server/domains/service";
import { redirectTo } from "@/server/http";
import { guarded } from "@/server/route-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// "Connect automatically" (Domain Connect, D-38): sends the creator to their
// DNS provider, which asks them to approve our one CNAME record.
async function getHandler(): Promise<Response> {
  const session = await currentSession();
  if (!session) return redirectTo("/login");
  const domain = await liveDomain(getDb(), session.account.id);
  const config = domainConnectConfig();
  const registrable = domain ? cookieDomain(domain.hostname) : null;
  if (!domain?.domainConnect || !config || !registrable) return redirectTo("/app/settings/domain");
  const host = domain.hostname.slice(0, -(registrable.length + 1));
  return redirectTo(applyUrl(domain.domainConnect, config, { registrable, host, redirectUri: `${appBaseUrl()}/app/settings/domain?checking=1` }), 302);
}

export const GET = guarded("/api/domain/connect", getHandler);
