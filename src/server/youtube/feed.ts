import { createHmac } from "node:crypto";
import { safeEqual } from "@/lib/crypto";

// New uploads are detected without quota (D-27): YouTube's PubSubHubbub
// (WebSub) push, with the public channel RSS feed as the fallback. Both
// deliver the same Atom format.
export const HUB_URL = "https://pubsubhubbub.appspot.com/subscribe";
export const LEASE_SECONDS = 10 * 86_400;

export function feedTopic(youtubeChannelId: string): string {
  return `https://www.youtube.com/xml/feeds/videos.xml?channel_id=${encodeURIComponent(youtubeChannelId)}`;
}

export const rssUrl = feedTopic;

// Per-channel hub secret derived from WEBSUB_SECRET, so no secret is stored.
export function websubSecret(masterSecret: string, channelId: string): string {
  return createHmac("sha256", masterSecret).update(`websub:${channelId}`).digest("hex");
}

// The hub signs each notification with HMAC-SHA1 of the raw body.
export function verifyHubSignature(body: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const [algorithm, signature] = header.split("=", 2);
  if (!signature || !["sha1", "sha256"].includes(algorithm ?? "")) return false;
  const expected = createHmac(algorithm!, secret).update(body).digest("hex");
  return safeEqual(signature.toLowerCase(), expected);
}

export interface FeedEntry {
  videoId: string;
  channelId: string;
  title: string | null;
  published: Date | null;
}

function tag(xml: string, name: string): string | null {
  const match = new RegExp(String.raw`<${name}(?:\s[^>]*)?>([\s\S]*?)</${name}>`).exec(xml);
  return match ? decodeXml(match[1]!.trim()) : null;
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, "&");
}

// Small, dependency-free Atom parser for the two fields we need. Deleted
// videos arrive as <at:deleted-entry> and have no <entry>, so they are skipped.
export function parseFeed(xml: string): FeedEntry[] {
  const entries: FeedEntry[] = [];
  for (const match of xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/g)) {
    const body = match[1]!;
    const videoId = tag(body, "yt:videoId");
    const channelId = tag(body, "yt:channelId");
    if (!videoId || !channelId) continue;
    const published = tag(body, "published");
    const date = published ? new Date(published) : null;
    entries.push({ videoId, channelId, title: tag(body, "title"), published: date && !Number.isNaN(date.getTime()) ? date : null });
  }
  return entries;
}

export const FRESH_WINDOW_MS = 48 * 3_600_000;
