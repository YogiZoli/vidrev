import { appBaseUrl, env } from "@/lib/env";

// Redirect to a path on this app; always absolute so it works behind the
// Railway proxy. Built by hand because Response.redirect() has immutable
// headers, and Next.js appends Set-Cookie from cookies() to the response.
export function redirectTo(pathOrUrl: string, status: 303 | 302 = 303): Response {
  const location = pathOrUrl.startsWith("http") ? pathOrUrl : `${appBaseUrl()}${pathOrUrl}`;
  return new Response(null, { status, headers: { location } });
}

// State-changing form posts must come from this app. Session cookies are
// SameSite=Lax as well; this is the second layer against CSRF.
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return env().NODE_ENV !== "production";
  try {
    return new URL(origin).origin === new URL(appBaseUrl()).origin;
  } catch {
    return false;
  }
}

export function clientIsSecure(): boolean {
  return appBaseUrl().startsWith("https://");
}
