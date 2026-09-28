import { createHash } from "node:crypto";
import { randomToken } from "@/lib/crypto";
import { timedFetch } from "@/lib/http";

// Token and revoke calls answer fast or not at all: never wait for ever.
const defaultFetch = timedFetch();

// Only these scopes, ever (SPEC section 7, brief). youtube.force-ssl covers
// reading comments and posting replies.
export const YOUTUBE_SCOPE = "https://www.googleapis.com/auth/youtube.force-ssl";
export const GOOGLE_SCOPES = ["openid", "email", "profile", YOUTUBE_SCOPE] as const;

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface GoogleClient {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomToken(48);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function buildAuthUrl(client: Pick<GoogleClient, "clientId" | "redirectUri">, state: string, codeChallenge: string): string {
  const params = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: client.redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    // Offline access plus consent every time, so Google always returns a
    // refresh token, also when the channel is reconnected.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  token_type: string;
}

export class GoogleOAuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "GoogleOAuthError";
  }
}

async function tokenRequest(body: URLSearchParams, fetchImpl: FetchLike): Promise<TokenResponse> {
  const response = await fetchImpl(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const json = (await response.json().catch(() => ({}))) as Partial<TokenResponse> & { error?: string; error_description?: string };
  if (!response.ok || !json.access_token) {
    throw new GoogleOAuthError(json.error ?? `http_${response.status}`, json.error_description ?? "token request failed");
  }
  return json as TokenResponse;
}

export function exchangeCode(client: GoogleClient, code: string, codeVerifier: string, fetchImpl: FetchLike = defaultFetch) {
  return tokenRequest(
    new URLSearchParams({
      code,
      client_id: client.clientId,
      client_secret: client.clientSecret,
      redirect_uri: client.redirectUri,
      grant_type: "authorization_code",
      code_verifier: codeVerifier,
    }),
    fetchImpl,
  );
}

export function refreshAccessToken(client: Omit<GoogleClient, "redirectUri">, refreshToken: string, fetchImpl: FetchLike = defaultFetch) {
  return tokenRequest(
    new URLSearchParams({
      refresh_token: refreshToken,
      client_id: client.clientId,
      client_secret: client.clientSecret,
      grant_type: "refresh_token",
    }),
    fetchImpl,
  );
}

// Revoking the refresh token also revokes its access tokens. A token Google
// no longer knows ("invalid_token") counts as revoked.
export async function revokeToken(token: string, fetchImpl: FetchLike = defaultFetch): Promise<void> {
  const response = await fetchImpl(REVOKE_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }).toString(),
  });
  if (response.ok) return;
  const json = (await response.json().catch(() => ({}))) as { error?: string };
  if (json.error === "invalid_token") return;
  throw new GoogleOAuthError(json.error ?? `http_${response.status}`, "token revocation failed");
}

// Google's granular consent lets a user untick the YouTube permission.
export function grantedYoutubeScope(scope: string): boolean {
  return scope.split(/\s+/).includes(YOUTUBE_SCOPE);
}
