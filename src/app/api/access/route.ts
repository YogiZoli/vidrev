import { getDb } from "@/db/client";
import { log } from "@/lib/log";
import { RateLimiter } from "@/lib/ratelimit";
import { ACCESS_ERROR_TEXT, redeemCoupon, startTrial } from "@/server/access";
import { currentSession } from "@/server/auth/current";
import { isSameOrigin, redirectTo } from "@/server/http";
import { guarded } from "@/server/route-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// 10 code tries an hour per account: codes cannot be guessed by brute force.
const codeTries = new RateLimiter(10, 60 * 60 * 1000);

// /activate: start the free trial or redeem a coupon code (DECISIONS A-20).
async function postHandler(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const session = await currentSession();
  if (!session) return redirectTo("/login");
  const form = await request.formData();
  const db = getDb();

  if (form.get("kind") === "trial") {
    const result = await startTrial(db, session.account.id);
    log("info", "trial requested", { accountId: session.account.id, ok: result.ok });
    return result.ok ? redirectTo("/onboarding") : redirectTo(`/activate?error=${encodeURIComponent(ACCESS_ERROR_TEXT[result.error])}`);
  }

  if (codeTries.hit(session.account.id)) return redirectTo(`/activate?error=${encodeURIComponent("Too many tries. Wait an hour.")}`);
  const result = await redeemCoupon(db, session.account.id, String(form.get("code") ?? ""));
  log("info", "coupon tried", { accountId: session.account.id, ok: result.ok, error: result.ok ? undefined : result.error });
  return result.ok ? redirectTo("/onboarding") : redirectTo(`/activate?error=${encodeURIComponent(ACCESS_ERROR_TEXT[result.error])}`);
}

export const POST = guarded("/api/access", postHandler);
