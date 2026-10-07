import { enqueue } from "@/jobs/enqueue";
import { errorFields, log } from "@/lib/log";
import { ghlWebhookKey } from "@/server/ghl/config";
import { verifyGhlSignature } from "@/server/ghl/oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Delivery URL of our Conversations provider (Beast Mode thread, A-25): the
// creator sent a message in a vidrev thread. A signature, when present, must
// verify; either way the worker reads the message back with our own token
// before anything is approved, so a forged call can never post a reply.
// Always 200 for accepted or ignored calls: the CRM retries anything else.
export async function POST(request: Request): Promise<Response> {
  const raw = await request.text();
  if (raw.length > 65_536) return Response.json({ error: "payload_too_large" }, { status: 413 });
  const signature = request.headers.get("x-ghl-signature");
  if (signature && !verifyGhlSignature(raw, signature, ghlWebhookKey())) {
    log("warn", "crm provider call refused", { reason: "bad signature" });
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
  const messageId = payload.messageId ?? payload.id;
  if (typeof payload.locationId !== "string" || typeof messageId !== "string") {
    log("info", "crm provider call ignored", { reason: "no location or message id", type: String(payload.type ?? "") });
    return Response.json({ ok: true, ignored: true });
  }
  // Only the ids travel to the worker; the text is read back from the CRM.
  const slim = { locationId: payload.locationId, messageId, type: String(payload.type ?? "") };
  try {
    await enqueue("ghl.outbound", { payload: slim }, { singletonKey: messageId });
  } catch (error) {
    log("error", "crm provider call not queued", errorFields(error));
    return Response.json({ error: "retry" }, { status: 503 });
  }
  log("info", "crm provider call queued", { signed: Boolean(signature), type: slim.type });
  return Response.json({ ok: true });
}
