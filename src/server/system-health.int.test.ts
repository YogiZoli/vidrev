import { randomUUID } from "node:crypto";
import { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/db/client";
import { recordHeartbeat } from "@/db/heartbeat";
import { channels, replies } from "@/db/schema";
import { runMigrations } from "@/scripts/migrate";
import { createAccountWithUser } from "./accounts";
import { systemHealth } from "./system-health";

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("system health (integration)", () => {
  beforeAll(async () => {
    await runMigrations(process.env.DATABASE_URL!);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("says the job tables are unreadable instead of pretending all is well", async () => {
    await recordHeartbeat(getDb(), "worker", "test");
    const health = await systemHealth(getDb());
    expect(health.worker.state).toBe("ok");
    expect(health.jobs).toBeNull();
    expect(health.jobsError).not.toBeNull();
    expect(health.ok).toBe(false);
  });

  it("lists jobs that failed for good with their last error, and stuck replies and channels", async () => {
    const boss = new PgBoss({ connectionString: process.env.DATABASE_URL!, supervise: false, schedule: false });
    await boss.start();
    await boss.createQueue("test.queue", { retryLimit: 0 });
    const id = (await boss.send("test.queue", { channelId: "c1" }))!;
    await boss.fetch("test.queue");
    await boss.fail("test.queue", id, { message: "Google said no" });
    await boss.stop({ graceful: false });

    const db = getDb();
    const now = new Date();
    await recordHeartbeat(db, "worker", "test", now);
    const { account } = await createAccountWithUser(db, { email: `sh-${randomUUID()}@example.com`, planCode: "standard_monthly" });
    const [channel] = await db.insert(channels).values({ accountId: account.id, youtubeChannelId: `UC${randomUUID()}`, status: "connected" }).returning();
    await db.insert(channels).values({ accountId: account.id, status: "rejected", statusReason: "connect_timeout", disconnectedAt: now });
    await db.insert(replies).values({
      accountId: account.id,
      channelId: channel!.id,
      youtubeVideoId: "VID1",
      keyword: "GUIDE",
      intent: "cold",
      language: "en",
      body: "Here: {link}",
      draftSource: "template",
      status: "sending",
      updatedAt: new Date(now.getTime() - 60 * 60_000),
    });

    const health = await systemHealth(db, now);
    expect(health.jobs?.failed).toEqual([expect.objectContaining({ queue: "test.queue", failed: 1, lastError: "Google said no" })]);
    expect(health.replies).toMatchObject({ sending: 1, stuck: 1 });
    expect(health.channels.timedOut).toBe(1);
    expect(health.ok).toBe(false);
  });
});
