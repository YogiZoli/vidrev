import { cookies } from "next/headers";
import { requireEnv } from "@/lib/env";
import { returnCookie } from "@/server/auth/return-to";
import { clientIsSecure, redirectTo } from "@/server/http";
import { guarded } from "@/server/route-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Not signed in on /connect/pdt: remember the connect page, then log in.
// After sign-in the login sends the creator back to it (DECISIONS A-30).
async function getHandler(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const back = new URLSearchParams();
  for (const key of ["redirect_uri", "state"]) {
    const value = params.get(key);
    if (value !== null) back.set(key, value.slice(0, 2000));
  }
  (await cookies()).set(returnCookie(`/connect/pdt?${back.toString()}`, requireEnv("AUTH_SECRET"), clientIsSecure()));
  return redirectTo("/login", 302);
}

export const GET = guarded("/api/connect/pdt/login", getHandler);
