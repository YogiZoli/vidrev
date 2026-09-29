import { type NextRequest, NextResponse } from "next/server";
import { linkHostOf } from "@/lib/link-host";

// Host routing for tracked links (SPEC section 2): requests on a link host
// are rewritten to the redirect route; everything else is the app.
const SLUG_PATH = /^\/([A-Za-z0-9]{7})\/?$/;

export function proxy(request: NextRequest) {
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
