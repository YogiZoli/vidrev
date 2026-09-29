import { getDb } from "@/db/client";
import { isValidEmail } from "@/lib/email";
import { errorFields, log } from "@/lib/log";
import { findUserByEmail } from "@/server/accounts";
import { isSameOrigin, redirectTo } from "@/server/http";
import { sendLoginLink } from "@/server/notify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Always answers the same way, so the form cannot be used to find out which
// emails have accounts.
export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const form = await request.formData();
  const email = String(form.get("email") ?? "");
  if (!isValidEmail(email)) return redirectTo("/login?error=email");

  try {
    const db = getDb();
    const found = await findUserByEmail(db, email);
    if (found) await sendLoginLink(db, { userId: found.user.id, email: found.user.email, welcome: false });
    // Nothing is sent and the page says the same either way (no account
    // probing); the log keeps a trace for "I never got the email".
    else log("info", "sign-in link asked for an address without an account", { domain: email.split("@")[1]?.toLowerCase() });
  } catch (error) {
    log("error", "magic link request failed", errorFields(error));
  }
  return redirectTo("/login?sent=1");
}
