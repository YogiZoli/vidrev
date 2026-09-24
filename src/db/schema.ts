import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

// One row per worker role; the worker upserts it every minute and the
// health endpoint reports its age.
export const workerHeartbeats = pgTable("worker_heartbeats", {
  id: text("id").primaryKey(),
  beatAt: timestamp("beat_at", { withTimezone: true }).notNull(),
  version: text("version").notNull(),
});
