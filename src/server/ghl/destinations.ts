import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { integrations } from "@/db/schema";
import { errorFields, log } from "@/lib/log";
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
  // Origin of the Sub-account website, the default domain for page paths.
  baseUrl: string | null;
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

function origin(website: string | null | undefined): string | null {
  if (!website) return null;
  try {
    return new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`).origin;
  } catch {
    return null;
  }
}

// Kept 10 minutes per account: the page is opened often, funnels change rarely.
const CACHE_MS = 10 * 60_000;
const cache = new Map<string, { at: number; list: DestinationList }>();

export function clearDestinationCache(): void {
  cache.clear();
}

// Reads without ever flagging the connection: a 401 or 403 here usually
// means the grant predates the funnel, survey and calendar scopes, so the
// creator is asked to reconnect, and nothing else changes.
export async function ghlDestinations(db: Db, accountId: string, deps: GhlDeps | null, now = new Date()): Promise<DestinationList> {
  const hit = cache.get(accountId);
  if (hit && now.getTime() - hit.at < CACHE_MS) return hit.list;
  const [row] = await db
    .select({ id: integrations.id })
    .from(integrations)
    .where(and(eq(integrations.accountId, accountId), eq(integrations.type, "ghl"), eq(integrations.status, "active")));
  if (!row || !deps) return { status: "not_connected", baseUrl: null, items: [] };

  let baseUrl: string | null = null;
  try {
    const config = await freshConfig(deps, row.id);
    baseUrl = origin(config.locationWebsite);
    const api = createGhlApi(deps.fetch, config.accessToken);
    const scoped = async <T>(what: string, run: () => Promise<T>): Promise<T | "missing"> => {
      try {
        return await run();
      } catch (error) {
        if (error instanceof GhlApiError && (error.status === 401 || error.status === 403)) {
          log("warn", "ghl destinations: scope missing, reconnect needed", { accountId, what, status: error.status });
          return "missing";
        }
        throw error;
      }
    };
    const [funnels, surveys, calendars] = await Promise.all([
      scoped("funnels", () => api.listFunnels(config.locationId)),
      scoped("surveys", () => api.listSurveys(config.locationId)),
      scoped("calendars", () => api.listCalendars(config.locationId)),
    ]);
    const items: Destination[] = [
      ...(funnels === "missing" ? [] : funnelDestinations(funnels)),
      ...(surveys === "missing" ? [] : surveys.map((s) => ({ kind: "survey" as const, name: s.name, url: SURVEY_URL(s.id) }))),
      ...(calendars === "missing" ? [] : calendars.map((c) => ({ kind: "calendar" as const, name: c.name, url: BOOKING_URL(c.id) }))),
    ];
    const missing = [funnels, surveys, calendars].some((r) => r === "missing");
    const list: DestinationList = { status: missing ? "reconnect" : "ok", baseUrl, items };
    if (!missing) cache.set(accountId, { at: now.getTime(), list });
    return list;
  } catch (error) {
    if (error instanceof GhlReauthError) return { status: "reconnect", baseUrl, items: [] };
    log("warn", "ghl destinations could not be read", { accountId, ...errorFields(error) });
    return { status: "error", baseUrl, items: [] };
  }
}
