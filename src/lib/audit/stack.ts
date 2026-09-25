import { isAffiliateHost } from "./links";

// Stack detection for Audit my channel (DECISIONS P9-06). Same signatures as
// the 03 research (c2c-market-research/fingerprint.py, validate.py), with the
// two lessons of that study built in: a GoHighLevel signal counts only on the
// creator's own page (never on gohighlevel.com affiliate pages), and tracking
// scripts alone (HubSpot, Mailchimp) do not count as a stack.

export type StackCategory = "crm" | "email" | "course" | "checkout" | "site" | "scheduling" | "affiliate";

export interface StackDefinition {
  id: string;
  label: string;
  category: StackCategory;
  // Lower-case substrings looked for in the final URL and the page.
  signals: string[];
  // Only the final URL (the host), not the page body.
  urlOnly?: boolean;
}

// Strict GoHighLevel assets, as validated in the research.
export const GHL_STRICT = ["leadconnectorhq", "msgsndr", "filesafe.space", "clientclub.net"];
// CNAME targets of GoHighLevel custom domains.
export const GHL_CNAME = ["leadconnector", "msgsndr", "ludicrous.cloud", "highlevel"];

export const STACKS: StackDefinition[] = [
  { id: "ghl", label: "GoHighLevel", category: "crm", signals: GHL_STRICT },
  { id: "kit", label: "Kit (ConvertKit)", category: "email", signals: ["convertkit", "ck.page", "kit.com/", "kit.co/"] },
  { id: "kajabi", label: "Kajabi", category: "course", signals: ["kajabi"] },
  { id: "clickfunnels", label: "ClickFunnels", category: "crm", signals: ["clickfunnels", "myclickfunnels"] },
  { id: "systeme", label: "Systeme.io", category: "crm", signals: ["systeme.io"] },
  { id: "stan", label: "Stan", category: "checkout", signals: ["stan.store"] },
  { id: "skool", label: "Skool", category: "course", signals: ["skool.com"] },
  { id: "teachable", label: "Teachable", category: "course", signals: ["teachable.com", "teachablecdn"] },
  { id: "thinkific", label: "Thinkific", category: "course", signals: ["thinkific"] },
  { id: "gumroad", label: "Gumroad", category: "checkout", signals: ["gumroad.com"] },
  { id: "podia", label: "Podia", category: "course", signals: ["podia.com"] },
  { id: "kartra", label: "Kartra", category: "crm", signals: ["kartra"] },
  { id: "activecampaign", label: "ActiveCampaign", category: "email", signals: ["activehosted", "activecampaign"] },
  { id: "mailchimp", label: "Mailchimp", category: "email", signals: ["mailchi.mp", "list-manage.com", "chimpstatic"] },
  { id: "hubspot", label: "HubSpot", category: "crm", signals: ["hsforms", "hs-sites.com", "hubspotpagebuilder", "hubspotlinks"] },
  { id: "beehiiv", label: "Beehiiv", category: "email", signals: ["beehiiv"] },
  { id: "calendly", label: "Calendly", category: "scheduling", signals: ["calendly.com"] },
  { id: "whop", label: "Whop", category: "checkout", signals: ["whop.com"] },
  { id: "shopify", label: "Shopify", category: "site", signals: ["cdn.shopify", "myshopify"] },
  { id: "amazon", label: "Amazon affiliate", category: "affiliate", signals: ["amzn.to", "amazon.com/"], urlOnly: true },
];

export interface Detection {
  id: string;
  label: string;
  category: StackCategory;
  evidence: string;
}

export interface PageEvidence {
  // Final URL after redirects.
  finalUrl: string;
  // Up to 1 MB of the page, or empty when it could not be read.
  body: string;
  // CNAME targets of the final host (lower-case), possibly empty.
  cnames: string[];
}

// Returns each stack once. The summary segment (`ghl` or `other`) follows from
// whether GoHighLevel was found.
export function detectStack(page: PageEvidence): Detection[] {
  const url = page.finalUrl.toLowerCase();
  let host = "";
  try {
    host = new URL(page.finalUrl).hostname.toLowerCase();
  } catch {
    host = "";
  }
  const body = page.body.toLowerCase();
  const found: Detection[] = [];

  for (const stack of STACKS) {
    if (stack.id === "ghl") {
      if (isAffiliateHost(host)) continue;
      const signal = GHL_STRICT.find((s) => url.includes(s) || body.includes(s));
      const cname = page.cnames.find((c) => GHL_CNAME.some((g) => c.includes(g)));
      if (signal) found.push({ id: stack.id, label: stack.label, category: stack.category, evidence: `${signal} on the page` });
      else if (cname) found.push({ id: stack.id, label: stack.label, category: stack.category, evidence: `${host} points to ${cname}` });
      continue;
    }
    const haystack = stack.urlOnly ? url : `${url} ${body}`;
    const signal = stack.signals.find((s) => haystack.includes(s));
    if (signal) found.push({ id: stack.id, label: stack.label, category: stack.category, evidence: stack.urlOnly ? `link goes to ${host}` : `${signal} on the page` });
  }
  return found;
}

export type Segment = "ghl" | "other" | "none";

export function segmentOf(detections: readonly Detection[], linksChecked: number): Segment {
  if (detections.some((d) => d.id === "ghl")) return "ghl";
  return linksChecked > 0 ? "other" : "none";
}

// Merges detections of several pages: one row per stack, first evidence wins.
export function mergeDetections(all: readonly Detection[]): Detection[] {
  const byId = new Map<string, Detection>();
  for (const d of all) if (!byId.has(d.id)) byId.set(d.id, d);
  return [...byId.values()];
}
