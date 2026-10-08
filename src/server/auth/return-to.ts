import { signValue, verifySignedValue } from "@/lib/signed";

// Where to go after sign-in when a page sent the visitor to log in first
// (the PDT connect page, DECISIONS A-30). A signed cookie for 15 minutes;
// only our own connect paths are accepted, so it can never become an open
// redirect.
export const RETURN_COOKIE = "vidrev_return";
const RETURN_TTL_MS = 15 * 60_000;

export function safeReturnPath(path: unknown): string | null {
  if (typeof path !== "string" || path.length > 3000) return null;
  return /^\/connect\/pdt(\?[^#\s]*)?$/.test(path) ? path : null;
}

export function returnCookie(path: string, secret: string, secure: boolean, now = new Date()) {
  return {
    name: RETURN_COOKIE,
    value: signValue({ path }, secret, new Date(now.getTime() + RETURN_TTL_MS)),
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
    maxAge: RETURN_TTL_MS / 1000,
  };
}

interface CookieStore {
  get(name: string): { value: string } | undefined;
  delete(name: string): unknown;
}

// The saved path (and the cookie is gone), else the fallback.
export function takeReturnPath(store: CookieStore, secret: string | undefined, fallback = "/app"): string {
  const raw = store.get(RETURN_COOKIE)?.value;
  if (!raw) return fallback;
  store.delete(RETURN_COOKIE);
  const saved = secret ? verifySignedValue<{ path: string }>(raw, secret) : null;
  return safeReturnPath(saved?.path) ?? fallback;
}
