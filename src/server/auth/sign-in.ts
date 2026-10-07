import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { users } from "@/db/schema";
import { hashPassword, verifyAgainstDummy, verifyPassword } from "@/lib/password";
import { createAccountWithUser, findUserByEmail, writeAudit } from "@/server/accounts";
import type { GoogleProfile } from "@/server/google/oauth";

// Self sign-ups start "registered" (locked) until a checkout activates them
// (DECISIONS A-16). The plan is a placeholder the checkout replaces.
const PLACEHOLDER_PLAN = "standard_monthly";

export type SignUpResult = { ok: true; userId: string } | { ok: false; reason: "exists" };

export async function signUpWithPassword(db: Db, input: { email: string; name: string | null; password: string }): Promise<SignUpResult> {
  if (await findUserByEmail(db, input.email)) return { ok: false, reason: "exists" };
  const passwordHash = await hashPassword(input.password);
  return db.transaction(async (tx) => {
    const made = await createAccountWithUser(tx, { email: input.email, name: input.name, planCode: PLACEHOLDER_PLAN, status: "registered" });
    await tx.update(users).set({ passwordHash }).where(eq(users.id, made.user.id));
    await writeAudit(tx, { actor: "user", accountId: made.account.id, action: "account.signed_up", details: { method: "password" } });
    return { ok: true as const, userId: made.user.id };
  });
}

// Same answer and about the same time for an unknown email and a wrong password.
export async function signInWithPassword(db: Db, email: string, password: string): Promise<string | null> {
  const found = await findUserByEmail(db, email);
  if (!found) return verifyAgainstDummy(password).then(() => null);
  return (await verifyPassword(password, found.user.passwordHash)) ? found.user.id : null;
}

export async function setPassword(db: Db, userId: string, password: string): Promise<void> {
  await db.update(users).set({ passwordHash: await hashPassword(password) }).where(eq(users.id, userId));
}

export type GoogleSignIn = { ok: true; userId: string; created: boolean } | { ok: false; reason: "email_unverified" };

// Known Google id signs in. Otherwise a verified Google email links to the
// user with that email (Google proved the mailbox), or creates a new sign-up.
export async function signInWithGoogle(db: Db, profile: GoogleProfile): Promise<GoogleSignIn> {
  const [bySub] = await db.select({ id: users.id }).from(users).where(eq(users.googleSub, profile.sub)).limit(1);
  if (bySub) return { ok: true, userId: bySub.id, created: false };
  if (!profile.emailVerified) return { ok: false, reason: "email_unverified" };

  const found = await findUserByEmail(db, profile.email);
  if (found) {
    await db.update(users).set({ googleSub: profile.sub }).where(eq(users.id, found.user.id));
    return { ok: true, userId: found.user.id, created: false };
  }
  return db.transaction(async (tx) => {
    const made = await createAccountWithUser(tx, { email: profile.email, name: profile.name, planCode: PLACEHOLDER_PLAN, status: "registered" });
    await tx.update(users).set({ googleSub: profile.sub }).where(eq(users.id, made.user.id));
    await writeAudit(tx, { actor: "user", accountId: made.account.id, action: "account.signed_up", details: { method: "google" } });
    return { ok: true as const, userId: made.user.id, created: true };
  });
}
