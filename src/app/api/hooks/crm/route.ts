import { and, eq, ne } from "drizzle-orm";
import { getDb } from "@/db/client";
import { integrations } from "@/db/schema";
import { enqueue } from "@/jobs/enqueue";
import { QUEUES } from "@/jobs/queues";
import { errorFields, log } from "@/lib/log";
import { wipeGhl } from "@/server/ghl/connect";
import { ghlWebhookKey } from "@/server/ghl/config";
import { verifyGhlSignature } from "@/server/ghl/oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Events worth a worker job; everything else is acknowledged and dropped.
const WORKER_EVENTS = new Set(["ContactCreate", "ContactUpdate", "ContactTagUpdate", "OpportunityStatusUpdate"]);
const UNINSTALL_EVENTS = new Set(["UNINSTALL", "AppUninstall"]);

// HighLevel Marketplace webhooks (default webhook URL of the app). Signed with
// Ed25519 in X-GHL-Signature over the raw body (SPEC-REVIEW R-05). The web
// service only verifies and queues; API calls run in the worker.
export async function POST(request: Request): Promise<Response> {
  const raw = await request.text();
  if (raw.length > 262_144) return Response.json({ error: "payload_too_large" }, { status: 413 });
  if (!verifyGhlSignature(raw, request.headers.get("x-ghl-signature"), ghlWebhookKey())) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  let payload: Record<string, unknown>;
  try {
    const json: unknown = JSON.parse(raw);
    if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("not an object");
    payload = json as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const type = String(payload.type ?? payload.event ?? "");
  const locationId = typeof payload.locationId === "string" ? payload.locationId : null;
  if (!locationId) return Response.json({ ok: true, ignored: "no_location" });
  try {
    const db = getDb();
    const [integration] = await db
      .select({ id: integrations.id })
      .from(integrations)
      .where(and(eq(integrations.type, "ghl"), eq(integrations.externalRef, locationId), ne(integrations.status, "removed")));
    if (!integration) return Response.json({ ok: true, ignored: "unknown_location" });

    if (UNINSTALL_EVENTS.has(type)) {
      // The app was removed inside HighLevel: the grant is gone, drop our side.
      await wipeGhl(db, integration.id, "uninstalled");
      log("info", "ghl app uninstalled", { integrationId: integration.id });
      return Response.json({ ok: true });
    }
    if (WORKER_EVENTS.has(type)) await enqueue(QUEUES.ghlEvent, { integrationId: integration.id, payload });
    return Response.json({ ok: true });
  } catch (error) {
    // A 5xx makes HighLevel retry with backoff (up to 12 times).
    log("error", "ghl webhook failed", { ...errorFields(error), type });
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
