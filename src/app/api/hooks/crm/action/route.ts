import { enqueue } from "@/jobs/enqueue";
import { QUEUES } from "@/jobs/queues";
import { getDb } from "@/db/client";
import { env } from "@/lib/env";
import { errorFields, log } from "@/lib/log";
import { actionResponse, findSource, noteText, parseActionRequest, verifyActionKey } from "@/server/ghl/action";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Execution URL of the marketplace workflow action "Find the video behind this
// contact" (DECISIONS P10-05). Reads our own rows only; the optional note on
// the contact is queued for the worker, so this never calls HighLevel.
function refuse(reason: string, status: number): Response {
  log("warn", "ghl workflow action refused", { reason, status });
  return Response.json({ error: reason }, { status });
}

export async function POST(request: Request): Promise<Response> {
  if (!verifyActionKey(request.headers.get("x-vidrev-key"), env().GHL_ACTION_SECRET)) {
    return refuse(env().GHL_ACTION_SECRET ? "unauthorized" : "unauthorized (GHL_ACTION_SECRET not set)", 401);
  }
  const raw = await request.text();
  if (raw.length > 65_536) return refuse("payload_too_large", 413);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return refuse("invalid_json", 400);
  }
  const parsed = parseActionRequest(body);
  if (!parsed) return refuse("missing_location_or_contact", 400);

  try {
    const lookup = await findSource(getDb(), parsed.locationId, parsed.contactId);
    if (lookup.status === "ok" && parsed.addNote) {
      // Same contact and same touch: one note, however often the step runs.
      await enqueue(
        QUEUES.ghlNote,
        { integrationId: lookup.integrationId, ghlContactId: parsed.contactId, text: noteText(lookup.source, env().PRODUCT_NAME) },
        { singletonKey: `note:${parsed.contactId}:${lookup.source.optedInAt.getTime()}` },
      );
    }
    log("info", "ghl workflow action answered", { status: lookup.status, locationId: parsed.locationId, noteQueued: lookup.status === "ok" && parsed.addNote });
    return Response.json(actionResponse(lookup));
  } catch (error) {
    // A 5xx lets HighLevel show the step as failed instead of silently empty.
    log("error", "ghl workflow action failed", errorFields(error));
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
