import { appBaseUrl, env, requireEnv } from "@/lib/env";
import type { GoogleClient } from "./oauth";

export const OAUTH_COOKIE = "g_oauth";
export const OAUTH_COOKIE_PATH = "/api/oauth/google";
export const OAUTH_COOKIE_TTL_MS = 10 * 60 * 1000;

export function googleConfigured(): boolean {
  const e = env();
  return Boolean(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET && e.AUTH_SECRET && e.ENCRYPTION_KEY);
}

// The app GCP project's OAuth client (D-27). Enterprise clients (D-32) come in Phase 11.
export function appGoogleClient(): GoogleClient {
  return {
    clientId: requireEnv("GOOGLE_CLIENT_ID"),
    clientSecret: requireEnv("GOOGLE_CLIENT_SECRET"),
    redirectUri: `${appBaseUrl()}/api/oauth/google/callback`,
  };
}

// Sign-in with Google uses the same OAuth client with its own redirect URI,
// which must be listed in the GCP console (docs/SETUP-GOOGLE.md).
export const SIGNIN_COOKIE = "g_signin";
export const SIGNIN_COOKIE_PATH = "/api/auth/google";

export function signInGoogleClient(): GoogleClient {
  return { ...appGoogleClient(), redirectUri: `${appBaseUrl()}/api/auth/google/callback` };
}
