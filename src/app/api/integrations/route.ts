import { getDb } from "@/db/client";
import { enqueue } from "@/jobs/enqueue";
import { QUEUES } from "@/jobs/queues";
import { requireEnv } from "@/lib/env";
import { currentSession } from "@/server/auth/current";
import { isSameOrigin, redirectTo } from "@/server/http";
import { rotateHookToken } from "@/server/integrations/inbound";
import { createEndpoint, queuePing, removeEndpoint, rotateSecret, setEndpointEnabled } from "@/server/integrations/outbound";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PAGE = "/app/integrations";

// Form posts from /app/integrations for outbound webhook endpoints. Delivery
// itself always runs in the worker.
export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const session = await currentSession();
  if (!session) return redirectTo("/login");
  const form = await request.formData();
  const field = (name: string) => String(form.get(name) ?? "");
  const accountId = session.account.id;
  const db = getDb();
  const key = requireEnv("ENCRYPTION_KEY");

  switch (field("action")) {
    case "add": {
      const result = await createEndpoint(db, key, {
        accountId,
        url: field("url"),
        label: field("label"),
        events: form.getAll("events").map(String),
      });
      return redirectTo(result.ok ? `${PAGE}?added=1` : `${PAGE}?error=${encodeURIComponent(result.error)}`);
    }
    case "enable":
    case "disable":
      await setEndpointEnabled(db, accountId, field("id"), field("action") === "enable");
      return redirectTo(PAGE);
    case "rotate":
      await rotateSecret(db, key, accountId, field("id"));
      return redirectTo(`${PAGE}?rotated=1`);
    case "remove":
      await removeEndpoint(db, accountId, field("id"));
      return redirectTo(`${PAGE}?removed=1`);
    case "hook_rotate":
      await rotateHookToken(db, key, accountId);
      return redirectTo(`${PAGE}?hook_rotated=1`);
    case "test": {
      const deliveryId = await queuePing(db, accountId, field("id"));
      if (deliveryId) await enqueue(QUEUES.webhookDeliver, { deliveryId }, { singletonKey: deliveryId });
      return redirectTo(`${PAGE}?tested=1`);
    }
    default:
      return redirectTo(PAGE);
  }
}
