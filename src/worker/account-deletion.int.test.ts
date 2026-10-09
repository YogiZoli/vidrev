import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/db/client";
import { accounts, auditLog, channels, users } from "@/db/schema";
import { runMigrations } from "@/scripts/migrate";
import { DELETION_DONE, DELETION_REQUESTED, DELETION_RETRY_MS, pendingDeletions, requestAccountDeletion } from "@/server/account-deletion";
import { createAccountWithUser } from "@/server/accounts";
import { createConnectingChannel } from "@/server/channels";
import { deleteAccount } from "./account-deletion";
import type { ChannelDeps } from "./channels";
import type { GhlWorkerDeps } from "./ghl";

const hasDb = Boolean(process.env.DATABASE_URL);
const key = randomBytes(32).toString("base64");

describe.skipIf(!hasDb)("account deletion (integration)", () => {
  beforeAll(async () => {
    await runMigrations(process.env.DATABASE_URL!);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("stops the account at once, then revokes, wipes and deletes it, keeping no email", async () => {
    const db = getDb();
    const email = `del-${randomUUID()}@example.com`;
    const { account, user } = await createAccountWithUser(db, { email, planCode: "standard_monthly" });
    const channelId = await createConnectingChannel(db, { accountId: account.id, refreshToken: "refresh-1", accessToken: "access-1", expiresInSeconds: 3600, scopes: "openid" }, key);
    await db.update(channels).set({ status: "connected" }).where(eq(channels.id, channelId));

    expect(await deleteAccount(deps([], []), account.id)).toBe("not_requested");

    await requestAccountDeletion(db, { accountId: account.id, userId: user.id });
    const [stopped] = await db.select().from(accounts).where(eq(accounts.id, account.id));
    expect(stopped!.status).toBe("suspended");
    expect((await db.select().from(channels).where(eq(channels.id, channelId)))[0]!.status).toBe("disconnecting");

    // Lost job: the hourly pass finds it once the retry time passed.
    expect(await pendingDeletions(db, new Date())).not.toContain(account.id);
    expect(await pendingDeletions(db, new Date(Date.now() + DELETION_RETRY_MS + 60_000))).toContain(account.id);

    const revoked: string[] = [];
    const sent: string[] = [];
    expect(await deleteAccount(deps(revoked, sent), account.id)).toBe("deleted");
    expect(revoked).toContain("https://oauth2.googleapis.com/revoke");
    expect(sent).toEqual([email]);
    expect(await db.select().from(accounts).where(eq(accounts.id, account.id))).toHaveLength(0);
    expect(await db.select().from(users).where(eq(users.id, user.id))).toHaveLength(0);
    expect(await db.select().from(channels).where(eq(channels.id, channelId))).toHaveLength(0);

    const trail = await db.select().from(auditLog).where(eq(auditLog.action, DELETION_REQUESTED));
    expect(JSON.stringify(trail)).not.toContain(email);
    const done = await db.select().from(auditLog).where(eq(auditLog.action, DELETION_DONE));
    expect(done.some((row) => (row.details as { accountId?: string }).accountId === account.id)).toBe(true);

    // Running again is harmless.
    expect(await deleteAccount(deps([], []), account.id)).toBe("gone");
    expect(await pendingDeletions(db, new Date(Date.now() + DELETION_RETRY_MS + 60_000))).not.toContain(account.id);
  });
});

function deps(calls: string[], sent: string[]) {
  const fetchImpl = async (url: string) => {
    calls.push(url);
    return new Response(null, { status: 200 });
  };
  const channelDeps: ChannelDeps = { db: getDb(), fetch: fetchImpl, encryptionKey: key, google: { clientId: "cid", clientSecret: "cs" } };
  return {
    channels: channelDeps,
    ghl: { db: getDb() } as unknown as GhlWorkerDeps,
    sendConfirmation: async (to: string) => {
      sent.push(to);
    },
  };
}
