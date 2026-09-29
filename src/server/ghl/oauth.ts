import { verify, createPublicKey } from "node:crypto";
import type { FetchLike } from "@/server/google/oauth";
import { GHL_API } from "./api";
import { timedFetch } from "@/lib/http";

// Token and revoke calls answer fast or not at all: never wait for ever.
const defaultFetch = timedFetch();

// OAuth for the Private Marketplace app (DECISIONS Q-17 b): location level
// installs only. Refresh tokens rotate: every refresh returns a new one and the
// old one dies, so refreshes must be serialized (see tokens.ts).

export const GHL_AUTH_URL = "https://marketplace.gohighlevel.com/oauth/chooselocation";

// Selected in the app's settings on the Marketplace as well; keep both in sync.
// GHL_SCOPES overrides this list without a deploy (scope names are the part of
// the docs that changes most often).
export const DEFAULT_GHL_SCOPES = [
  "contacts.readonly",
  "contacts.write",
  "opportunities.readonly",
  "payments/transactions.readonly",
  "locations.readonly",
  "locations/customFields.readonly",
  "locations/customFields.write",
];

// Extra scopes for the "Where do they go?" list (pages, surveys, calendars).
// Requested only when GHL_DESTINATION_SCOPES=1: a scope the Marketplace app does
// not have makes HighLevel refuse the whole connect ("Invalid scope"), so they
// are switched on only after the app's scope list is confirmed.
export const DESTINATION_GHL_SCOPES = ["funnels/funnel.readonly", "funnels/page.readonly", "funnels/redirect.readonly", "surveys.readonly", "calendars.readonly"];

export interface GhlClient {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function buildInstallUrl(client: Pick<GhlClient, "clientId" | "redirectUri">, scopes: string[], state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    redirect_uri: client.redirectUri,
    client_id: client.clientId,
    scope: scopes.join(" "),
    state,
  });
  // Apps that are not public yet install through their draft version, which is
  // the part of the client id before the dash.
  const version = client.clientId.split("-")[0];
  if (version && client.clientId.includes("-")) params.set("version_id", version);
  return `${GHL_AUTH_URL}?${params.toString()}`;
}

export interface GhlTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: string;
  userType?: string;
  companyId?: string;
  locationId?: string;
  userId?: string;
}

export class GhlOAuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "GhlOAuthError";
  }
}

async function tokenRequest(body: URLSearchParams, fetchImpl: FetchLike): Promise<GhlTokenResponse> {
  const response = await fetchImpl(`${GHL_API}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: body.toString(),
  });
  const json = (await response.json().catch(() => ({}))) as Partial<GhlTokenResponse> & { error?: string; error_description?: string; message?: string };
  if (!response.ok || !json.access_token || !json.refresh_token) {
    throw new GhlOAuthError(json.error ?? `http_${response.status}`, json.error_description ?? json.message ?? "token request failed");
  }
  return json as GhlTokenResponse;
}

export function exchangeGhlCode(client: GhlClient, code: string, fetchImpl: FetchLike = defaultFetch) {
  return tokenRequest(
    new URLSearchParams({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      grant_type: "authorization_code",
      code,
      user_type: "Location",
      redirect_uri: client.redirectUri,
    }),
    fetchImpl,
  );
}

export function refreshGhlToken(client: Pick<GhlClient, "clientId" | "clientSecret">, refreshToken: string, fetchImpl: FetchLike = defaultFetch) {
  return tokenRequest(
    new URLSearchParams({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      user_type: "Location",
    }),
    fetchImpl,
  );
}

// HighLevel's public key for marketplace webhooks (X-GHL-Signature, Ed25519).
// Published in the Webhook Integration Guide; GHL_WEBHOOK_PUBLIC_KEY overrides
// it if HighLevel rotates the key.
export const GHL_WEBHOOK_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAi2HR1srL4o18O8BRa7gVJY7G7bupbN3H9AwJrHCDiOg=
-----END PUBLIC KEY-----`;

export function verifyGhlSignature(rawBody: string, signatureBase64: string | null, publicKeyPem: string = GHL_WEBHOOK_PUBLIC_KEY): boolean {
  if (!signatureBase64) return false;
  try {
    return verify(null, Buffer.from(rawBody, "utf8"), createPublicKey(publicKeyPem), Buffer.from(signatureBase64.trim(), "base64"));
  } catch {
    return false;
  }
}
