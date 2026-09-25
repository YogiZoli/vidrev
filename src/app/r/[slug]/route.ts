import { getDb } from "@/db/client";
import { env } from "@/lib/env";
import { errorFields, log } from "@/lib/log";
import { fallbackHost, linkHostOf } from "@/lib/link-host";
import { emitFromWeb } from "@/server/integrations/emit-web";
import { resolveClick } from "@/server/links";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "cache-control": "no-store", "x-robots-tag": "noindex" };

function page(status: number, text: string): Response {
  return new Response(`<!doctype html><meta name="robots" content="noindex"><title>${text}</title><p style="font-family:sans-serif">${text}</p>`, {
    status,
    headers: { ...NO_STORE, "content-type": "text/html; charset=utf-8" },
  });
}

function clientIp(headers: Headers): string | null {
  return headers.get("cf-connecting-ip") ?? headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? headers.get("x-real-ip");
}

// Tracked link redirect (SPEC section 8). Reached through src/proxy.ts on a
// link host, or directly at /r/<slug> on the app host for testing.
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { AUTH_SECRET } = env();
  const fallback = fallbackHost();
  const host = linkHostOf(request.headers) ?? new URL(request.url).hostname;
  try {
    const result = await resolveClick(getDb(), {
      slug,
      host,
      ip: clientIp(request.headers),
      userAgent: request.headers.get("user-agent"),
      country: request.headers.get("cf-ipcountry"),
      referer: request.headers.get("referer"),
      ipSecret: AUTH_SECRET ?? "",
      fallbackHost: fallback,
    });
    if (result.kind === "not_found") return page(404, "This link does not exist.");
    if (result.kind === "blocked") return page(410, "This link is no longer available.");
    const headers = new Headers({ ...NO_STORE, location: result.location, "referrer-policy": "no-referrer-when-downgrade" });
    if (result.setCookie) headers.append("set-cookie", result.setCookie);
    // Outbound link_clicked event (Phase 6), after the redirect is decided.
    if (result.clicked) void emitFromWeb(getDb(), { accountId: result.clicked.accountId, event: "link_clicked", occurredAt: result.clicked.occurredAt, context: result.clicked.context });
    return new Response(null, { status: 302, headers });
  } catch (error) {
    log("error", "link redirect failed", { ...errorFields(error), slug });
    return page(503, "Please try again in a moment.");
  }
}
