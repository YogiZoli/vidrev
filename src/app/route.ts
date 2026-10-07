import { currentSession } from "@/server/auth/current";
import { redirectTo } from "@/server/http";
import { LANDING_HTML } from "./landing-html";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Front door of the app host: the approved landing (DECISIONS A-18), with
// Get started and Log in. Signed-in users go straight to the app.
export async function GET(): Promise<Response> {
  if (await currentSession()) return redirectTo("/app");
  return new Response(LANDING_HTML, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
