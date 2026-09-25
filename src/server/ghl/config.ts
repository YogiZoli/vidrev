import { appBaseUrl, env } from "@/lib/env";
import { DEFAULT_GHL_SCOPES, type GhlClient } from "./oauth";

export const GHL_COOKIE = "ghl_oauth";
export const GHL_COOKIE_PATH = "/api/oauth/crm";
export const GHL_COOKIE_TTL_MS = 10 * 60 * 1000;

export function ghlConfigured(): boolean {
  const e = env();
  return Boolean(e.GHL_CLIENT_ID && e.GHL_CLIENT_SECRET && e.AUTH_SECRET && e.ENCRYPTION_KEY);
}

export function ghlClient(): GhlClient {
  const e = env();
  if (!e.GHL_CLIENT_ID || !e.GHL_CLIENT_SECRET) throw new Error("GHL_CLIENT_ID or GHL_CLIENT_SECRET is not set");
  return { clientId: e.GHL_CLIENT_ID, clientSecret: e.GHL_CLIENT_SECRET, redirectUri: `${appBaseUrl()}/api/oauth/crm/callback` };
}

export function ghlScopes(): string[] {
  const custom = env().GHL_SCOPES?.split(/[\s,]+/).filter(Boolean);
  return custom && custom.length > 0 ? custom : DEFAULT_GHL_SCOPES;
}

export function ghlWebhookKey(): string | undefined {
  return env().GHL_WEBHOOK_PUBLIC_KEY?.replace(/\\n/g, "\n");
}
