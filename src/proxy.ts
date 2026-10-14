import { type NextRequest, NextResponse } from "next/server";
import { brandHostOf, linkHostOf } from "@/lib/link-host";

// Host routing (SPEC section 2):
// - the marketing host (vidrev.app and www) shows the landing at "/" and
//   sends every other path to the app host, so sign-in, OAuth and forms only
//   ever run on APP_BASE_URL;
// - requests on a link host are rewritten to the redirect route;
// - everything else is the app.
const SLUG_PATH = /^\/([A-Za-z0-9]{7})\/?$/;
const BRAND_PATHS = /^\/(?:vidrev-logo\.png|icon(?:\.png)?|favicon\.ico|robots\.txt)?$/;

export function proxy(request: NextRequest) {
  if (brandHostOf(request.headers)) {
    const app = process.env.APP_BASE_URL?.trim().replace(/\/+$/, "");
    if (!app || BRAND_PATHS.test(request.nextUrl.pathname)) return NextResponse.next();
    return NextResponse.redirect(`${app}${request.nextUrl.pathname}${request.nextUrl.search}`, 308);
  }
  const host = linkHostOf(request.headers);
  if (!host || request.nextUrl.pathname === "/vidrev.js") return NextResponse.next();
  const url = request.nextUrl.clone();
  const slug = SLUG_PATH.exec(url.pathname)?.[1];
  url.pathname = slug ? `/r/${slug}` : "/r/_";
  url.search = "";
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ["/((?!_next/|favicon.ico).*)"],
};
