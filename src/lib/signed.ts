import { createHmac } from "node:crypto";
import { safeEqual } from "./crypto";

// Small signed, expiring values for short-lived cookies (OAuth state and PKCE
// verifier). Format: base64url(json).base64url(hmac).
export function signValue(data: Record<string, unknown>, secret: string, expiresAt: Date): string {
  const body = Buffer.from(JSON.stringify({ ...data, exp: expiresAt.getTime() })).toString("base64url");
  return `${body}.${mac(body, secret)}`;
}

export function verifySignedValue<T extends Record<string, unknown>>(
  value: string | undefined,
  secret: string,
  now = new Date(),
): T | null {
  if (!value) return null;
  const [body, signature] = value.split(".");
  if (!body || !signature || !safeEqual(signature, mac(body, secret))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T & { exp?: number };
    if (typeof parsed.exp !== "number" || parsed.exp <= now.getTime()) return null;
    return parsed;
  } catch {
    return null;
  }
}

function mac(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}
