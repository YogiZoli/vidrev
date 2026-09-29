import { getDb } from "@/db/client";
import { env } from "@/lib/env";
import { timedFetch } from "@/lib/http";
import type { GhlDeps } from "@/server/ghl/tokens";
import type { ChannelDeps } from "@/worker/channels";

// YouTube access from the web service (the video list on Automations):
// the same token handling as the worker, with a time limit on every call.
export function webChannelDeps(): (ChannelDeps & { quotaLimit: number }) | null {
  const { ENCRYPTION_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, QUOTA_DAILY_LIMIT } = env();
  if (!ENCRYPTION_KEY || !GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return null;
  return {
    db: getDb(),
    fetch: timedFetch(8_000),
    encryptionKey: ENCRYPTION_KEY,
    google: { clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET },
    quotaLimit: QUOTA_DAILY_LIMIT,
  };
}

// GoHighLevel reads from the web service (the "Where do they go?" list).
export function webGhlDeps(): GhlDeps | null {
  const { ENCRYPTION_KEY, GHL_CLIENT_ID, GHL_CLIENT_SECRET } = env();
  if (!ENCRYPTION_KEY) return null;
  return {
    db: getDb(),
    fetch: timedFetch(8_000),
    encryptionKey: ENCRYPTION_KEY,
    client: GHL_CLIENT_ID && GHL_CLIENT_SECRET ? { clientId: GHL_CLIENT_ID, clientSecret: GHL_CLIENT_SECRET } : null,
  };
}
