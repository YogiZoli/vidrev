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
  if (!authorized) return Response.json({ error: "unauthorized" }, { status: 401 });

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = provisioningPayloadSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_payload", issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) },
      { status: 400 },
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
      log("error", "provisioning side effect failed", { ...errorFields(error), accountId: outcome.accountId });
    }
    return Response.json({ result: outcome.result }, { status: outcome.httpStatus });
  } catch (error) {
    log("error", "provisioning failed", errorFields(error));
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
