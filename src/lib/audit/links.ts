// Description links for Audit my channel (DECISIONS P9-05). Same method as the
// 03 research: links from the channel description and the last videos, social
// and platform hosts skipped, at most 8 unique links followed, link hubs
// expanded one hop.

const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;

export const MAX_LINKS = 8;

const SKIP_HOSTS = [
  "youtube.com", "youtu.be", "instagram.com", "tiktok.com", "facebook.com", "fb.me", "twitter.com", "x.com",
  "linkedin.com", "threads.net", "pinterest.", "spotify.com", "apple.com", "discord.gg", "discord.com",
  "t.me", "wa.me", "reddit.com", "twitch.tv", "google.com",
];

export const HUB_HOSTS = ["linktr.ee", "beacons.ai", "bio.link", "taplink", "hoo.be", "lnk.bio", "komi.io", "campsite.bio", "linkin.bio"];

// Redirectors that count clicks, so a link through them is measured.
const CLICK_TRACKERS = ["bit.ly", "bitly.com", "rebrand.ly", "short.io", "t.ly", "geni.us", "ow.ly", "dub.sh", "dub.co", "buff.ly", "tiny.cc", "cutt.ly", "lnk.to"];

// Registrable domains of platforms that host pages under their own name. A
// link on one of these is not on the creator's own domain.
const PLATFORM_DOMAINS = [
  ...HUB_HOSTS, ...CLICK_TRACKERS,
  "kajabi.com", "mykajabi.com", "kit.com", "kit.co", "convertkit.com", "ck.page", "teachable.com", "thinkific.com", "gumroad.com", "gum.co",
  "podia.com", "stan.store", "skool.com", "whop.com", "patreon.com", "systeme.io", "kartra.com", "clickfunnels.com", "myclickfunnels.com",
  "leadconnectorhq.com", "msgsndr.com", "gohighlevel.com", "highlevel.com", "hubspot.com", "hs-sites.com", "mailchi.mp", "beehiiv.com", "substack.com",
  "calendly.com", "shopify.com", "myshopify.com", "wixsite.com", "wix.com", "squarespace.com", "webflow.io", "carrd.co", "notion.site",
  "amazon.com", "amzn.to", "amzn.com", "lemonsqueezy.com", "thrivecart.com", "samcart.com", "payhip.com", "buy.stripe.com", "paypal.com", "paypal.me",
  "google.com", "docs.google.com", "drive.google.com", "airtable.com", "typeform.com", "tally.so",
];

const AFFILIATE_HOSTS = ["gohighlevel.com", "highlevel.com"];

function cleanUrl(raw: string): string {
  return raw.replace(/[.,;:!?]+$/, "");
}

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function hostMatches(host: string, list: readonly string[]): boolean {
  return list.some((entry) => (entry.endsWith(".") ? host.includes(entry) : host === entry || host.endsWith(`.${entry}`)));
}

export function isSkippedHost(host: string): boolean {
  return hostMatches(host, SKIP_HOSTS);
}

export function isHubHost(host: string): boolean {
  return HUB_HOSTS.some((hub) => host === hub || host.endsWith(`.${hub}`) || (hub === "taplink" && host.includes("taplink")));
}

export function isAffiliateHost(host: string): boolean {
  return hostMatches(host, AFFILIATE_HOSTS);
}

// Offer links of one description: everything that is not a social or platform
// address, unique, in order.
export function extractLinks(text: string | null | undefined): string[] {
  const found: string[] = [];
  for (const match of (text ?? "").matchAll(URL_RE)) {
    const url = cleanUrl(match[0]);
    const host = hostOf(url);
    if (host && !isSkippedHost(host) && !found.includes(url)) found.push(url);
  }
  return found;
}

export type Measured = "utm" | "click_tracker" | null;

// A link is measured when it carries UTM parameters (the destination's
// analytics see the source) or goes through a click-counting redirector. Not a
// judgement of quality: only whether a click can be traced back to a video.
export function measuredBy(url: string): Measured {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if ([...parsed.searchParams.keys()].some((key) => key.toLowerCase().startsWith("utm_") || key.toLowerCase() === "c2c_tid")) return "utm";
  return hostMatches(parsed.hostname.toLowerCase(), CLICK_TRACKERS) ? "click_tracker" : null;
}

// True when the host is not a shared platform or shortener address.
export function isOwnDomain(host: string): boolean {
  return !hostMatches(host.toLowerCase(), PLATFORM_DOMAINS);
}
