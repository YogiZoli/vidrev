import { getDb } from "@/db/client";
import { env } from "@/lib/env";
import { errorFields, log } from "@/lib/log";
import { alertOwners, sendLoginLink } from "@/server/notify";
import { handleProvisioning } from "@/server/provisioning/handle";
import { authorizeProvisioning, provisioningPayloadSchema } from "@/server/provisioning/payload";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Called by GHL workflows after checkout events (SPEC section 6,
// docs/GHL-PROVISIONING.md). Billing itself never happens in the app.
// A refused provisioning call means a checkout did not create or change an
// account: logged and emailed to the owner at once, with the reason.
async function refuse(reason: string, status: number, detail: string[] = []): Promise<Response> {
  log("error", "provisioning refused", { reason, status, detail: detail.join(" | ") });
  try {
    await alertOwners([
      {
        subject: `Provisioning webhook refused: ${reason}`,
        lines: [
          `GoHighLevel called the provisioning webhook and it was refused (${status} ${reason}).`,
          "A checkout may not have created or changed an account. Check the GoHighLevel workflow (URL, secret, body).",
          ...detail,
        ],
      },
    ]);
  } catch (error) {
    log("error", "provisioning alert could not be queued", errorFields(error));
  }
  return Response.json({ error: reason, ...(detail.length ? { issues: detail } : {}) }, { status });
}

export async function POST(request: Request): Promise<Response> {
  const secret = env().PROVISIONING_SECRET;
  if (!secret) {
    log("error", "provisioning called but PROVISIONING_SECRET is not set");
    return Response.json({ error: "not_configured" }, { status: 503 });
  }

  const rawBody = await request.text();
  const authorized = authorizeProvisioning(
    { authorization: request.headers.get("authorization"), signature: request.headers.get("x-signature") },
    rawBody,
    secret,
  );
  if (!authorized) return refuse("unauthorized", 401, [`Signature header present: ${Boolean(request.headers.get("x-signature"))}`]);

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return refuse("invalid_json", 400);
  }
  const parsed = provisioningPayloadSchema.safeParse(json);
  if (!parsed.success) {
    return refuse(
      "invalid_payload",
      400,
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    );
  }

  try {
    const db = getDb();
    const outcome = await handleProvisioning(db, parsed.data);
    log("info", "provisioning event", {
      event: parsed.data.event,
      externalId: parsed.data.external_id,
      result: outcome.result,
      accountId: outcome.accountId,
    });
    // Side effects run after commit; a failure here is logged, not retried by
    // GHL, because the account change itself already succeeded.
    try {
      if (outcome.loginLink) await sendLoginLink(db, outcome.loginLink);
      await alertOwners(outcome.ownerAlerts);
    } catch (error) {
      // The account exists but the sign-in email did not go out: the
      // customer cannot get in until the owner resends it from /admin.
      log("error", "provisioning side effect failed", { ...errorFields(error), accountId: outcome.accountId });
      await alertOwners([
        {
          subject: "New customer did not get the sign-in email",
          lines: [`Account: ${outcome.accountId ?? "unknown"}`, `Error: ${String(errorFields(error).error)}`, "Resend access from /admin (Grant access with the same email)."],
        },
      ]).catch((alertError: unknown) => log("error", "provisioning alert could not be queued", errorFields(alertError)));
    }
    return Response.json({ result: outcome.result }, { status: outcome.httpStatus });
  } catch (error) {
    log("error", "provisioning failed", errorFields(error));
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
