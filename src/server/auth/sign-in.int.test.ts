import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/db/client";
import { runMigrations } from "@/scripts/migrate";
import { createAccountWithUser, findUserByEmail } from "../accounts";
import { setPassword, signInWithGoogle, signInWithPassword, signUpWithPassword } from "./sign-in";

const hasDb = Boolean(process.env.DATABASE_URL);
const email = () => `signin-${randomUUID()}@example.com`;

describe.skipIf(!hasDb)("sign-in (integration)", () => {
  beforeAll(async () => {
    await runMigrations(process.env.DATABASE_URL!);
  });
  afterAll(async () => {
    await closeDb();
  });

  it("signs up a registered account and signs in with the password", async () => {
    const db = getDb();
    const address = email();
    const made = await signUpWithPassword(db, { email: address, name: "Ann", password: "long enough" });
    expect(made.ok).toBe(true);
    expect((await findUserByEmail(db, address))?.account.status).toBe("registered");
    expect(await signUpWithPassword(db, { email: address, name: null, password: "long enough" })).toEqual({ ok: false, reason: "exists" });
    expect(await signInWithPassword(db, address.toUpperCase(), "long enough")).toBe(made.ok ? made.userId : null);
    expect(await signInWithPassword(db, address, "wrong password")).toBeNull();
    expect(await signInWithPassword(db, email(), "long enough")).toBeNull();
  });

  it("lets a checkout account set its first password", async () => {
    const db = getDb();
    const address = email();
    const { user } = await createAccountWithUser(db, { email: address, planCode: "standard_monthly" });
    expect(await signInWithPassword(db, address, "new password")).toBeNull();
    await setPassword(db, user.id, "new password");
    expect(await signInWithPassword(db, address, "new password")).toBe(user.id);
  });

  it("links Google to an existing email, creates new sign-ups, refuses unverified emails", async () => {
    const db = getDb();
    const address = email();
    const { user } = await createAccountWithUser(db, { email: address, planCode: "standard_monthly" });
    const sub = randomUUID();
    expect(await signInWithGoogle(db, { sub, email: address, emailVerified: true, name: null })).toEqual({ ok: true, userId: user.id, created: false });
    expect(await signInWithGoogle(db, { sub, email: "changed@example.com", emailVerified: true, name: null })).toEqual({ ok: true, userId: user.id, created: false });

    const fresh = email();
    const created = await signInWithGoogle(db, { sub: randomUUID(), email: fresh, emailVerified: true, name: "Bo" });
    expect(created.ok && created.created).toBe(true);
    expect((await findUserByEmail(db, fresh))?.account.status).toBe("registered");

    expect(await signInWithGoogle(db, { sub: randomUUID(), email: email(), emailVerified: false, name: null })).toEqual({ ok: false, reason: "email_unverified" });
  });
});
