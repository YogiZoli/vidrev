import { getDb } from "@/db/client";
import { isValidEmail } from "@/lib/email";
import { errorFields, log } from "@/lib/log";
import { RateLimiter } from "@/lib/ratelimit";
import { createAccountWithUser, findUserByEmail, writeAudit } from "@/server/accounts";
import { clientIp } from "@/lib/client-ip";
import { isSameOrigin, redirectTo } from "@/server/http";
import { sendLoginLink } from "@/server/notify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// A sign-up is free; the account stays "registered" (locked) until a checkout
// activates it. 5 sign-ups an hour per address keeps the form from being a
// mail cannon.
const limiter = new RateLimiter(5, 60 * 60 * 1000);
const PLACEHOLDER_PLAN = "standard_monthly";

// Answers the same way whether or not the email already has an account, so the
// form cannot be used to find out who is a customer: either way a link goes out.
export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim();
  const name = String(form.get("name") ?? "").trim().slice(0, 120) || null;
  if (!isValidEmail(email)) return redirectTo("/signup?error=email");
  if (limiter.hit(clientIp(request.headers) ?? "unknown")) return redirectTo("/signup?error=busy");

  try {
    const db = getDb();
    const found = await findUserByEmail(db, email);
    if (found) {
      await sendLoginLink(db, { userId: found.user.id, email: found.user.email, welcome: false });
    } else {
      const created = await db.transaction(async (tx) => {
        const made = await createAccountWithUser(tx, { email, name, planCode: PLACEHOLDER_PLAN, status: "registered" });
        await writeAudit(tx, { actor: "user", accountId: made.account.id, action: "account.signed_up" });
        return made;
      });
      await sendLoginLink(db, { userId: created.user.id, email: created.user.email, welcome: true });
      log("info", "account signed up", { accountId: created.account.id });
    }
  } catch (error) {
    log("error", "sign-up failed", errorFields(error));
  }
  return redirectTo("/signup?sent=1");
}
