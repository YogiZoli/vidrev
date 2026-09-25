import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { parseEmailList } from "@/lib/email";
import { env } from "@/lib/env";
import { clientIsSecure } from "@/server/http";
import { findSession, SESSION_TTL_MS, type SessionContext } from "./tokens";

export const SESSION_COOKIE = "sid";

export async function currentSession(): Promise<SessionContext | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return findSession(getDb(), token);
}

export async function requireSession(): Promise<SessionContext> {
  const session = await currentSession();
  if (!session) redirect("/login");
  return session;
}

export function isAdminEmail(email: string): boolean {
  return parseEmailList(env().ADMIN_EMAILS).includes(email);
}

export async function requireAdmin(): Promise<SessionContext> {
  const session = await requireSession();
  if (!isAdminEmail(session.user.email)) redirect("/app");
  return session;
}

export function sessionCookie(token: string) {
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: clientIsSecure(),
    sameSite: "lax" as const,
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  };
}
