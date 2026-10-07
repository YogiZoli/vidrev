import { cookies } from "next/headers";
import { getDb } from "@/db/client";
import { SESSION_COOKIE } from "@/server/auth/current";
import { deleteSession } from "@/server/auth/tokens";
import { isSameOrigin, redirectTo } from "@/server/http";
import { log } from "@/lib/log";
import { guarded } from "@/server/route-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function postHandler(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await deleteSession(getDb(), token);
  log("info", "user signed out", { hadSession: Boolean(token) });
  store.delete(SESSION_COOKIE);
  return redirectTo("/login");
}

export const POST = guarded("/api/auth/logout", postHandler);
