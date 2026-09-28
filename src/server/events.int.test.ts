import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, type Db, getDb } from "@/db/client";
import { auditLog } from "@/db/schema";
import { runMigrations } from "@/scripts/migrate";
import { createAccountWithUser } from "./accounts";
import { recordAction } from "./events";

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("recordAction (integration)", () => {
  beforeAll(async () => {
    await runMigrations(process.env.DATABASE_URL!);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("logs the action and keeps it in audit_log with who and what", async () => {
    const db = getDb();
    const { account, user } = await createAccountWithUser(db, { email: `ev-${randomUUID()}@example.com`, planCode: "standard_monthly" });
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => void lines.push(line));
    await recordAction(db, { userId: user.id, accountId: account.id }, "campaign.pause", { campaignId: "c1" });
    vi.restoreAllMocks();
    const [row] = await db.select().from(auditLog).where(eq(auditLog.accountId, account.id));
    expect(row).toMatchObject({ actor: `user:${user.id}`, action: "campaign.pause", details: { campaignId: "c1" } });
    expect(JSON.parse(lines[0]!)).toMatchObject({ level: "info", msg: "campaign.pause", accountId: account.id, campaignId: "c1" });
  });

  it("never breaks the action when the audit write fails, and logs why", async () => {
    const broken = { insert: () => ({ values: async () => Promise.reject(new Error("connection lost")) }) } as unknown as Db;
    const errors: string[] = [];
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation((line: string) => void errors.push(line));
    await expect(recordAction(broken, { userId: "u", accountId: "a" }, "campaign.create")).resolves.toBeUndefined();
    vi.restoreAllMocks();
    expect(JSON.parse(errors[0]!)).toMatchObject({ msg: "audit entry could not be written", action: "campaign.create", error: "connection lost" });
  });
});
