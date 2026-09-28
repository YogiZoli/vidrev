import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { accounts } from "@/db/schema";
import { requireEnv } from "@/lib/env";
import { currentSession } from "@/server/auth/current";
import { isSameOrigin, redirectTo } from "@/server/http";
import { completeOnboardingIfReady, onboardingState, parseTargetUrl } from "@/server/onboarding";
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

  switch (field("action")) {
    case "purchase_ghl":
      if (!state.done.crm) return redirectTo(PAGE);
      await db.update(accounts).set({ purchaseSource: "ghl" }).where(eq(accounts.id, accountId));
      break;
    case "purchase_stripe": {
      if (!state.done.crm) return redirectTo(PAGE);
      const result = await connectStripe(db, requireEnv("ENCRYPTION_KEY"), accountId, field("apiKey"));
      if (!result.ok) return redirectTo(`${PAGE}?error=${encodeURIComponent(result.error)}`);
      await db.update(accounts).set({ purchaseSource: "stripe" }).where(eq(accounts.id, accountId));
      break;
    }
    case "target": {
      if (!state.done.purchases) return redirectTo(PAGE);
      const url = parseTargetUrl(field("url"));
      if (!url) return redirectTo(`${PAGE}?error=${encodeURIComponent("Enter the full address of your opt-in page, for example https://example.com/guide.")}`);
      await db.update(accounts).set({ defaultTargetUrl: url }).where(eq(accounts.id, accountId));
      break;
    }
    default:
      return redirectTo(PAGE);
  }
  return redirectTo((await completeOnboardingIfReady(db, accountId)) ? "/app?welcome=1" : PAGE);
}
