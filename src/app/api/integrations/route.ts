import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { integrations } from "@/db/schema";
import { enqueue } from "@/jobs/enqueue";
import { QUEUES } from "@/jobs/queues";
import { requireEnv } from "@/lib/env";
import { currentSession } from "@/server/auth/current";
import { isSameOrigin, redirectTo } from "@/server/http";
import { disconnectGhl } from "@/server/ghl/connect";
import { connectStripe, disconnectStripe } from "@/server/stripe/connect";
import { updateGhlConfig } from "@/server/ghl/tokens";
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
    case "ghl_disconnect":
      await disconnectGhl(db, accountId, field("id"));
      return redirectTo(`${PAGE}?ghl_disconnected=1`);
    case "ghl_sync": {
      // The engine tick picks it up within a minute.
      await db
        .update(integrations)
        .set({ nextSyncAt: new Date() })
        .where(and(eq(integrations.id, field("id")), eq(integrations.accountId, accountId), eq(integrations.type, "ghl"), eq(integrations.status, "active")));
      return redirectTo(`${PAGE}?ghl_sync=1`);
    }
    case "ghl_buyer_tag": {
      const [row] = await db
        .select({ id: integrations.id })
        .from(integrations)
        .where(and(eq(integrations.id, field("id")), eq(integrations.accountId, accountId), eq(integrations.type, "ghl")));
      if (row) await updateGhlConfig({ db, fetch, encryptionKey: key, client: null }, row.id, { buyerTag: field("buyerTag").trim().slice(0, 60) });
      return redirectTo(`${PAGE}?ghl_saved=1`);
    }
    case "stripe_connect": {
      const result = await connectStripe(db, key, accountId, field("apiKey"));
      return redirectTo(result.ok ? `${PAGE}?stripe_connected=1` : `${PAGE}?error=${encodeURIComponent(result.error)}`);
    }
    case "stripe_disconnect":
      await disconnectStripe(db, accountId, field("id"));
      return redirectTo(`${PAGE}?stripe_disconnected=1`);
    case "stripe_sync": {
      // The engine tick picks it up within a minute.
      await db
        .update(integrations)
        .set({ nextSyncAt: new Date() })
        .where(and(eq(integrations.id, field("id")), eq(integrations.accountId, accountId), eq(integrations.type, "stripe"), eq(integrations.status, "active")));
      return redirectTo(`${PAGE}?stripe_sync=1`);
    }
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
