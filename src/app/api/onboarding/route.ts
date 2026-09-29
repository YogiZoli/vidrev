import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { accounts } from "@/db/schema";
import { requireEnv } from "@/lib/env";
import { currentSession } from "@/server/auth/current";
import { isSameOrigin, redirectTo } from "@/server/http";
import { logRefused, recordAction } from "@/server/events";
import { completeOnboardingIfReady, onboardingState, parseTargetUrl } from "@/server/onboarding";
import { isOwnHost, OWN_HOST_ERROR, ownHosts } from "@/server/own-hosts";
import { connectStripe } from "@/server/stripe/connect";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PAGE = "/onboarding";

// Form posts from /onboarding: purchase source and default target URL. The
// YouTube and GoHighLevel steps run through their OAuth routes.
export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const session = await currentSession();
  if (!session) return redirectTo("/login");
  const form = await request.formData();
  const field = (name: string) => String(form.get(name) ?? "");
  const accountId = session.account.id;
  const db = getDb();
  const state = await onboardingState(db, accountId);
  const who = { userId: session.user.id, accountId };
  const action = field("action");
  // A step posted before the one it needs is done (an old tab): back to the page.
  const early = (needs: string) => {
    logRefused(`onboarding.${action}`, `step ${needs} not done`, { accountId, current: state.current });
    return redirectTo(PAGE);
  };

  switch (action) {
    case "purchase_ghl":
      if (!state.done.crm) return early("crm");
      await db.update(accounts).set({ purchaseSource: "ghl" }).where(eq(accounts.id, accountId));
      await recordAction(db, who, "onboarding.purchase_source", { source: "ghl" });
      break;
    case "purchase_stripe": {
      if (!state.done.crm) return early("crm");
      const result = await connectStripe(db, requireEnv("ENCRYPTION_KEY"), accountId, field("apiKey"));
      if (!result.ok) {
        logRefused("onboarding.stripe", result.error, { accountId });
        return redirectTo(`${PAGE}?error=${encodeURIComponent(result.error)}`);
      }
      await db.update(accounts).set({ purchaseSource: "stripe" }).where(eq(accounts.id, accountId));
      await recordAction(db, who, "onboarding.purchase_source", { source: "stripe" });
      break;
    }
    case "target": {
      if (!state.done.purchases) return early("purchases");
      const url = parseTargetUrl(field("url"));
      if (!url) {
        logRefused("onboarding.target", "invalid url", { accountId });
        return redirectTo(`${PAGE}?error=${encodeURIComponent("Enter the full address of your opt-in page, for example https://example.com/guide.")}`);
      }
      if (isOwnHost(url, await ownHosts(db, accountId))) {
        logRefused("onboarding.target", "own host", { accountId, host: new URL(url).host });
        return redirectTo(`${PAGE}?error=${encodeURIComponent(OWN_HOST_ERROR)}`);
      }
      await db.update(accounts).set({ defaultTargetUrl: url }).where(eq(accounts.id, accountId));
      await recordAction(db, who, "onboarding.target_url", { host: new URL(url).host });
      break;
    }
    default:
      logRefused("onboarding", "unknown action", { accountId, action });
      return redirectTo(PAGE);
  }
  const done = await completeOnboardingIfReady(db, accountId);
  if (done) await recordAction(db, who, "onboarding.completed");
  return redirectTo(done ? "/app?welcome=1" : PAGE);
}
