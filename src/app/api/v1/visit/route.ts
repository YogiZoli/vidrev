import { getDb } from "@/db/client";
import { errorFields, log } from "@/lib/log";
import { claimDirectTids } from "@/server/links";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADERS = { "cache-control": "no-store", "access-control-allow-origin": "*" };

// Visit beacon from /vidrev.js (A-38). A direct branded link has no redirect,
// so the opt-in page reports the tracking id once; the first report of a
// direct tid is recorded as its click. Unknown ids, redirect-click ids and
// bots are ignored. Always answers 204 so the page never waits or learns more.
export async function POST(request: Request): Promise<Response> {
  try {
    const text = (await request.text()).slice(0, 2000);
    const body = JSON.parse(text || "{}") as { tid?: unknown };
    if (typeof body.tid === "string") {
      await claimDirectTids(getDb(), null, [body.tid], {
        userAgent: request.headers.get("user-agent"),
        referer: request.headers.get("referer"),
        country: request.headers.get("cf-ipcountry"),
      });
    }
  } catch (error) {
    log("warn", "visit beacon failed", errorFields(error));
  }
  return new Response(null, { status: 204, headers: HEADERS });
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: { ...HEADERS, "access-control-allow-methods": "POST", "access-control-allow-headers": "content-type" } });
}
