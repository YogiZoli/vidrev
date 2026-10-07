import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/db/client";
import { accounts } from "@/db/schema";
import { runMigrations } from "@/scripts/migrate";
import { createAccountWithUser } from "./accounts";
import { crmSyncModeState, setCrmSyncMode } from "./crm-sync-mode";

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("crm sync mode (integration)", () => {
  beforeAll(async () => {
    await runMigrations(process.env.DATABASE_URL!);
  });

  afterAll(async () => {
    await closeDb();
  });

  async function freshAccount() {
    const email = `mode-${randomUUID()}@example.com`;
    const { account } = await createAccountWithUser(getDb(), { email, planCode: "standard_monthly" });
    return { account, email };
  }

  it("starts in Clean Mode and refuses Beast Mode off the allowlist", async () => {
    const db = getDb();
    const { account } = await freshAccount();
    expect(await crmSyncModeState(db, account.id, "")).toEqual({ saved: "clean", allowed: false, effective: "clean" });
    expect(await setCrmSyncMode(db, account.id, "beast", "someone@else.com")).toEqual({ ok: false, error: "Beast Mode is coming soon." });
    const [row] = await db.select({ mode: accounts.crmSyncMode }).from(accounts).where(eq(accounts.id, account.id));
    expect(row?.mode).toBe("clean");
  });

  it("lets an allowlisted user's account switch to Beast Mode and back", async () => {
    const db = getDb();
    const { account, email } = await freshAccount();
    const list = `someone@else.com, ${email.toUpperCase()}`;
    expect(await setCrmSyncMode(db, account.id, "beast", list)).toEqual({ ok: true });
    expect((await crmSyncModeState(db, account.id, list)).effective).toBe("beast");
    // Taken off the list: the saved choice stays, the worker acts as Clean Mode.
    expect(await crmSyncModeState(db, account.id, "")).toEqual({ saved: "beast", allowed: false, effective: "clean" });
    expect(await setCrmSyncMode(db, account.id, "clean", "")).toEqual({ ok: true });
    expect((await crmSyncModeState(db, account.id, list)).saved).toBe("clean");
  });
});
