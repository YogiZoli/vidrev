import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "@/scripts/migrate";
import { closeDb, getDb } from "./client";
import { latestHeartbeat, recordHeartbeat } from "./heartbeat";

// Runs only where a real Postgres is available (CI service container).
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("database (integration)", () => {
  beforeAll(async () => {
    await runMigrations(process.env.DATABASE_URL!);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("applies migrations idempotently", async () => {
    await expect(runMigrations(process.env.DATABASE_URL!)).resolves.toBeUndefined();
  });

  it("upserts and reads the worker heartbeat", async () => {
    const db = getDb();
    const first = new Date("2026-09-25T10:00:00Z");
    const second = new Date("2026-09-25T10:01:00Z");
    await recordHeartbeat(db, "test-worker", "t1", first);
    await recordHeartbeat(db, "test-worker", "t2", second);
    expect((await latestHeartbeat(db))?.toISOString()).toBe(second.toISOString());
  });
});
