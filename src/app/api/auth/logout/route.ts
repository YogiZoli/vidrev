import { cookies } from "next/headers";
import { getDb } from "@/db/client";
import { SESSION_COOKIE } from "@/server/auth/current";
import { deleteSession } from "@/server/auth/tokens";
import { isSameOrigin, redirectTo } from "@/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await deleteSession(getDb(), token);
  store.delete(SESSION_COOKIE);
  return redirectTo("/login");
}
