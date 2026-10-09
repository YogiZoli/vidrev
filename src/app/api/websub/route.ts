import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { channels } from "@/db/schema";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { FREE_WEBSUB } from "@/lib/quota";
import { recordQuota } from "@/server/channels";
import { feedTopic, parseFeed, verifyHubSignature, websubSecret } from "@/server/youtube/feed";
import { applyFeedEntries } from "@/server/uploads";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function findChannel(url: URL) {
  const id = url.searchParams.get("c") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [channel] = await getDb().select().from(channels).where(eq(channels.id, id));
  return channel?.youtubeChannelId ? channel : null;
}

// Hub verification of a (un)subscription. Only connected channels confirm a
// subscribe; for anything else the hub gets 404 and drops the subscription.
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const channel = await findChannel(url);
  const mode = url.searchParams.get("hub.mode");
  const challenge = url.searchParams.get("hub.challenge") ?? "";
  if (!channel || url.searchParams.get("hub.topic") !== feedTopic(channel.youtubeChannelId!)) {
    return new Response("Not found", { status: 404 });
  }
  if (mode === "subscribe" && channel.status === "connected") {
    const lease = Number(url.searchParams.get("hub.lease_seconds") ?? 0);
    const expiresAt = new Date(Date.now() + (Number.isFinite(lease) && lease > 0 ? lease : 86_400) * 1000);
    await getDb().update(channels).set({ websubExpiresAt: expiresAt }).where(eq(channels.id, channel.id));
    return new Response(challenge, { status: 200, headers: { "content-type": "text/plain" } });
  }
  if (mode === "unsubscribe") {
    await getDb().update(channels).set({ websubExpiresAt: null }).where(eq(channels.id, channel.id));
    return new Response(challenge, { status: 200, headers: { "content-type": "text/plain" } });
  }
  return new Response("Not found", { status: 404 });
}

// New upload notification. Always answers 2xx so the hub does not retry;
// unsigned or wrongly signed bodies are ignored (WebSub spec).
export async function POST(request: Request): Promise<Response> {
  const body = await request.text();
  const secret = env().WEBSUB_SECRET;
  const channel = await findChannel(new URL(request.url));
  if (!secret || !channel || channel.status !== "connected") return new Response(null, { status: 202 });
  if (!verifyHubSignature(body, request.headers.get("x-hub-signature"), websubSecret(secret, channel.id))) {
    log("warn", "websub notification with a bad signature", { channelId: channel.id });
    return new Response(null, { status: 202 });
  }
  const now = new Date();
  // Zero units, recorded so the quota request can show what push saves.
  await recordQuota(getDb(), { gcpProject: "app", method: FREE_WEBSUB, units: 0, accountId: channel.accountId }, now);
  await applyFeedEntries(getDb(), channel, parseFeed(body), now);
  return new Response(null, { status: 204 });
}
