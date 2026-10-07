import { getDb } from "@/db/client";
import { isValidEmail } from "@/lib/email";
import { errorFields, log } from "@/lib/log";
import { findUserByEmail } from "@/server/accounts";
import { isSameOrigin, redirectTo } from "@/server/http";
import { sendPasswordReset } from "@/server/notify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Same answer whether or not the email has an account.
export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const email = String((await request.formData()).get("email") ?? "").trim();
  if (!isValidEmail(email)) return redirectTo("/forgot?error=email");
  try {
    const db = getDb();
    const found = await findUserByEmail(db, email);
    if (found) await sendPasswordReset(db, { userId: found.user.id, email: found.user.email });
  } catch (error) {
    log("error", "password reset request failed", errorFields(error));
  }
  return redirectTo("/forgot?sent=1");
}
