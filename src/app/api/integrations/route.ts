import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { integrations } from "@/db/schema";
import { enqueue } from "@/jobs/enqueue";
import { QUEUES } from "@/jobs/queues";
import { requireEnv } from "@/lib/env";
import { currentSession } from "@/server/auth/current";
import { isSameOrigin, redirectTo } from "@/server/http";
import { logRefused, recordAction } from "@/server/events";
import { returnPath } from "@/server/onboarding";
import { disconnectGhl } from "@/server/ghl/connect";
import { connectStripe, disconnectStripe } from "@/server/stripe/connect";
import { updateGhlConfig } from "@/server/ghl/tokens";
import { rotateHookToken } from "@/server/integrations/inbound";
import { createEndpoint, queuePing, removeEndpoint, rotateSecret, setEndpointEnabled } from "@/server/integrations/outbound";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Each action returns to its own Settings page.
const WEBHOOKS = "/app/settings/webhooks";
const GHL = "/app/settings/gohighlevel";
const STRIPE = "/app/settings/stripe";
const INBOUND = "/app/settings/inbound";

// Form posts from the Settings integration pages. Delivery
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

  const action = field("action");
  const who = { userId: session.user.id, accountId };
  const ref = { integrationId: field("id") || undefined };
  // Recorded after it happened; a refusal is logged with its reason instead.
  const done = (details: Record<string, unknown> = {}) => recordAction(db, who, `integration.${action}`, { ...ref, ...details });

  switch (action) {
    case "add": {
      const result = await createEndpoint(db, key, {
        accountId,
        url: field("url"),
        label: field("label"),
        events: form.getAll("events").map(String),
      });
      if (!result.ok) logRefused("integration.add", result.error, { accountId });
      else await done({ host: safeHost(field("url")) });
      return redirectTo(result.ok ? `${WEBHOOKS}?added=1` : `${WEBHOOKS}?error=${encodeURIComponent(result.error)}`);
    }
    case "enable":
    case "disable":
      await setEndpointEnabled(db, accountId, field("id"), field("action") === "enable");
      await done();
      return redirectTo(WEBHOOKS);
    case "rotate":
      await rotateSecret(db, key, accountId, field("id"));
      await done();
      return redirectTo(`${WEBHOOKS}?rotated=1`);
    case "remove":
      await removeEndpoint(db, accountId, field("id"));
      await done();
      return redirectTo(`${WEBHOOKS}?removed=1`);
    case "ghl_disconnect":
      await disconnectGhl(db, accountId, field("id"));
      await done();
      return redirectTo(returnPath(session.account, `${GHL}?ghl_disconnected=1`));
    case "ghl_sync": {
      // The engine tick picks it up within a minute.
      await db
        .update(integrations)
        .set({ nextSyncAt: new Date() })
        .where(and(eq(integrations.id, field("id")), eq(integrations.accountId, accountId), eq(integrations.type, "ghl"), eq(integrations.status, "active")));
      await done();
      return redirectTo(`${GHL}?ghl_sync=1`);
    }
    case "ghl_buyer_tag": {
      const [row] = await db
        .select({ id: integrations.id })
        .from(integrations)
        .where(and(eq(integrations.id, field("id")), eq(integrations.accountId, accountId), eq(integrations.type, "ghl")));
      if (row) await updateGhlConfig({ db, fetch, encryptionKey: key, client: null }, row.id, { buyerTag: field("buyerTag").trim().slice(0, 60) });
      await done();
      return redirectTo(`${GHL}?ghl_saved=1`);
    }
    case "stripe_connect": {
      const result = await connectStripe(db, key, accountId, field("apiKey"));
      if (!result.ok) logRefused("integration.stripe_connect", result.error, { accountId });
      else await done();
      return redirectTo(returnPath(session.account, result.ok ? `${STRIPE}?stripe_connected=1` : `${STRIPE}?error=${encodeURIComponent(result.error)}`));
    }
    case "stripe_disconnect":
      await disconnectStripe(db, accountId, field("id"));
      await done();
      return redirectTo(`${STRIPE}?stripe_disconnected=1`);
    case "stripe_sync": {
      // The engine tick picks it up within a minute.
      await db
        .update(integrations)
        .set({ nextSyncAt: new Date() })
        .where(and(eq(integrations.id, field("id")), eq(integrations.accountId, accountId), eq(integrations.type, "stripe"), eq(integrations.status, "active")));
      await done();
      return redirectTo(`${STRIPE}?stripe_sync=1`);
    }
    case "hook_rotate":
      await rotateHookToken(db, key, accountId);
      await done();
      return redirectTo(`${INBOUND}?hook_rotated=1`);
    case "test": {
      const deliveryId = await queuePing(db, accountId, field("id"));
      if (deliveryId) await enqueue(QUEUES.webhookDeliver, { deliveryId }, { singletonKey: deliveryId });
      await done();
      return redirectTo(`${WEBHOOKS}?tested=1`);
    }
    default:
      logRefused("integration", "unknown action", { accountId, action });
      return redirectTo(WEBHOOKS);
  }
}

function safeHost(url: string): string | undefined {
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}
