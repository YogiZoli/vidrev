import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { integrations } from "@/db/schema";
import { errorFields, log } from "@/lib/log";
import type { PageFetcher } from "@/server/audit/fetch-page";
import { createGhlApi, GhlApiError, type GhlFunnel } from "./api";
import { freshConfig, type GhlDeps, GhlReauthError } from "./tokens";

// "Where do they go?": the pages, surveys and booking calendars of the
// creator's GoHighLevel Sub-account, grouped by what the viewer does there.
export type DestinationKind = "optin" | "order" | "page" | "survey" | "calendar";

export interface Destination {
  kind: DestinationKind;
  name: string;
  // Funnel and website pages: a path on the creator's domain (the API does
  // not give the domain name). Surveys and calendars: a full GoHighLevel link.
  path?: string;
  url?: string;
}

export interface DestinationList {
  status: "ok" | "not_connected" | "reconnect" | "error";
  // The domain the funnel pages are served on: verified (a candidate host
  // answered 200 for a real page path) or, when none did, the Sub-account
  // website as a best guess the creator should check.
  baseUrl: string | null;
  domainVerified: boolean;
  items: Destination[];
}

// GoHighLevel's hosted links, valid on every Sub-account without a domain.
export const SURVEY_URL = (id: string) => `https://api.leadconnectorhq.com/widget/survey/${id}`;
export const BOOKING_URL = (id: string) => `https://api.leadconnectorhq.com/widget/booking/${id}`;

export function stepKind(stepType: string | undefined): DestinationKind {
  const type = (stepType ?? "").toLowerCase();
  if (/(order|checkout|upsell|downsell|payment)/.test(type)) return "order";
  if (/optin|opt_in|opt-in/.test(type)) return "optin";
  return "page";
}

export function funnelDestinations(funnels: GhlFunnel[]): Destination[] {
  const out: Destination[] = [];
  for (const funnel of funnels) {
    for (const step of funnel.steps ?? []) {
      if (!step.url) continue;
      const path = step.url.startsWith("/") ? step.url : `/${step.url}`;
      const name = funnel.name && step.name && step.name !== funnel.name ? `${funnel.name}: ${step.name}` : (step.name ?? funnel.name ?? path);
      out.push({ kind: funnel.type === "website" && stepKind(step.type) === "page" ? "page" : stepKind(step.type), name, path });
    }
  }
  return out;
}

// A bare lowercase host from anything GoHighLevel or a person gives us
// ("https://www.vidrev.app/", "vidrev.app/x"); "" when not a plausible host.
export function normalizeHost(raw: string | null | undefined): string {
  const value = (raw ?? "").trim();
  if (!value) return "";
  try {
    const host = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).hostname.toLowerCase();
    return host.includes(".") ? host : "";
  } catch {
    return "";
  }
}

// Hosts worth testing, best first: the Sub-account's connected domain, the
// hosts in its funnel redirects, its website (with and without www), then the
// usual funnel subdomains of that domain. The app's own hosts never count.
export function domainCandidates(input: { locationDomain: string | null; redirectHosts: string[]; website: string | null }, ownHosts: string[]): string[] {
  const out: string[] = [];
  const add = (raw: string | null | undefined) => {
    const host = normalizeHost(raw);
    if (host && !out.includes(host) && !ownHosts.includes(host)) out.push(host);
  };
  add(input.locationDomain);
  for (const h of input.redirectHosts) add(h);
  const site = normalizeHost(input.website);
  if (site) {
    add(site);
    const root = site.startsWith("www.") ? site.slice(4) : site;
    add(root);
    add(`www.${root}`);
    const parts = root.split(".");
    const base = parts.length > 2 ? parts.slice(-2).join(".") : root;
    for (const sub of ["go", "get", "link", "join"]) add(`${sub}.${base}`);
  }
  return out;
}

// Asks each candidate whether it really serves one of the funnel's own page
// paths (200 after redirects). Only a host that passes is used, so a guess can
// never produce a link that 404s. At most 8 hosts and 2 paths.
export async function probeFunnelHost(candidates: string[], paths: string[], fetchPage: PageFetcher): Promise<string | null> {
  const probePaths = paths.filter((p) => p.startsWith("/")).slice(0, 2);
  if (probePaths.length === 0) return null;
  for (const host of candidates.slice(0, 8)) {
    for (const path of probePaths) {
      const result = await fetchPage(`https://${host}${path}`);
      if (result.status === 200) {
        log("info", "funnel domain verified", { host, path });
        return host;
      }
    }
  }
  log("info", "funnel domain not verified", { tried: candidates.slice(0, 8).join(","), paths: probePaths.join(",") });
  return null;
}

// Kept 10 minutes per account: the page is opened often, funnels change rarely.
const CACHE_MS = 10 * 60_000;
const cache = new Map<string, { at: number; list: DestinationList }>();

export function clearDestinationCache(): void {
  cache.clear();
}

type Source<T> = T | "missing" | "failed";

// Reads without ever flagging the connection: a 401 or 403 here usually
// means the grant predates the funnel, survey and calendar scopes, so the
// creator is asked to reconnect. Each source stands alone: one failing
// (HighLevel down, a changed limit) never hides the others.
export async function ghlDestinations(
  db: Db,
  accountId: string,
  deps: (GhlDeps & { fetchPage: PageFetcher; ownHosts: string[] }) | null,
  now = new Date(),
): Promise<DestinationList> {
  const hit = cache.get(accountId);
  if (hit && now.getTime() - hit.at < CACHE_MS) return hit.list;
  const [row] = await db
    .select({ id: integrations.id })
    .from(integrations)
    .where(and(eq(integrations.accountId, accountId), eq(integrations.type, "ghl"), eq(integrations.status, "active")));
  if (!row || !deps) return { status: "not_connected", baseUrl: null, domainVerified: false, items: [] };

  try {
    const config = await freshConfig(deps, row.id);
    const api = createGhlApi(deps.fetch, config.accessToken);
    const read = async <T>(what: string, run: () => Promise<T>): Promise<Source<T>> => {
      try {
        return await run();
      } catch (error) {
        if (error instanceof GhlApiError && (error.status === 401 || error.status === 403)) {
          log("warn", "ghl destinations: scope missing, reconnect needed", { accountId, what, status: error.status });
          return "missing";
        }
        log("warn", "ghl destinations: one source failed", { accountId, what, ...errorFields(error) });
        return "failed";
      }
    };
    const [funnels, surveys, calendars, redirects, location] = await Promise.all([
      read("funnels", () => api.listFunnels(config.locationId)),
      read("surveys", () => api.listSurveys(config.locationId)),
      read("calendars", () => api.listCalendars(config.locationId)),
      read("redirects", () => api.listRedirectHosts(config.locationId)),
      read("location", () => api.getLocation(config.locationId)),
    ]);
    const pages = Array.isArray(funnels) ? funnelDestinations(funnels) : [];
    const items: Destination[] = [
      ...pages,
      ...(Array.isArray(surveys) ? surveys.map((s) => ({ kind: "survey" as const, name: s.name, url: SURVEY_URL(s.id) })) : []),
      ...(Array.isArray(calendars) ? calendars.map((c) => ({ kind: "calendar" as const, name: c.name, url: BOOKING_URL(c.id) })) : []),
    ];

    const website = typeof location === "object" ? location.website : (config.locationWebsite ?? null);
    const candidates = domainCandidates(
      { locationDomain: typeof location === "object" ? location.domain : null, redirectHosts: Array.isArray(redirects) ? redirects : [], website },
      deps.ownHosts,
    );
    const verified = pages.length ? await probeFunnelHost(candidates, pages.map((p) => p.path ?? ""), deps.fetchPage) : null;
    const guess = normalizeHost(website);
    const baseUrl = verified ? `https://${verified}` : guess ? `https://${guess}` : null;

    const sources = [funnels, surveys, calendars];
    const missing = sources.some((r) => r === "missing");
    const failedAll = sources.every((r) => r === "failed");
    const list: DestinationList = { status: missing ? "reconnect" : failedAll ? "error" : "ok", baseUrl, domainVerified: Boolean(verified), items };
    if (!missing && !sources.some((r) => r === "failed")) cache.set(accountId, { at: now.getTime(), list });
    return list;
  } catch (error) {
    if (error instanceof GhlReauthError) return { status: "reconnect", baseUrl: null, domainVerified: false, items: [] };
    log("warn", "ghl destinations could not be read", { accountId, ...errorFields(error) });
    return { status: "error", baseUrl: null, domainVerified: false, items: [] };
  }
}
