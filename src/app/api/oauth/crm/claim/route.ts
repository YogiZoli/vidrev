import { cookies } from "next/headers";
import { getDb } from "@/db/client";
import { enqueue } from "@/jobs/enqueue";
import { QUEUES } from "@/jobs/queues";
import { requireEnv } from "@/lib/env";
import { errorFields, log } from "@/lib/log";
import { verifySignedValue } from "@/lib/signed";
import { currentSession } from "@/server/auth/current";
import { GHL_CLAIM_COOKIE, GHL_CLAIM_PAGE } from "@/server/ghl/config";
import { claimInstall } from "@/server/ghl/install";
import { isSameOrigin, redirectTo } from "@/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const back = (reason: string) => redirectTo(`${GHL_CLAIM_PAGE}?error=${reason}`);

// The signed-in account takes the grant that a Marketplace install left
// waiting (DECISIONS P10-01). The claim token comes from the installer's
// browser cookie, never from the form, so a link cannot be passed around.
export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const session = await currentSession();
  if (!session) return redirectTo("/login");
  if (session.account.status !== "active") return back("suspended");

  const store = await cookies();
  const claim = verifySignedValue<{ token: string }>(store.get(GHL_CLAIM_COOKIE)?.value, requireEnv("AUTH_SECRET"));
  if (!claim) return back("expired");

  try {
    const result = await claimInstall(getDb(), requireEnv("ENCRYPTION_KEY"), session.account.id, claim.token);
    if (!result.ok) return back(result.error);
    store.delete({ name: GHL_CLAIM_COOKIE, path: "/" });
    await enqueue(QUEUES.ghlSetup, { integrationId: result.id }, { singletonKey: result.id });
    log("info", "ghl marketplace install claimed", { accountId: session.account.id, integrationId: result.id });
    return redirectTo("/app/settings/integrations?ghl_connected=1");
  } catch (error) {
    log("error", "ghl claim failed", errorFields(error));
    return back("failed");
  }
}
