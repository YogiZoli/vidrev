import { and, count, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { latestHeartbeat } from "@/db/heartbeat";
import { accounts, channels, integrations, replies } from "@/db/schema";
import { evaluateHealth, type WorkerState } from "@/lib/health";
import { errorFields, log } from "@/lib/log";

// The owner's one view of whether the app works (review finding 16): worker
// heartbeat, jobs that failed for good or are retrying, and anything stuck.
export const HEALTH_WINDOW_MS = 24 * 3_600_000;
// The send recovery checks after 10 minutes; 30 means it could not help.
export const STUCK_SENDING_MS = 30 * 60_000;

export interface FailedQueue {
  queue: string;
  failed: number;
  lastAt: Date | null;
  lastError: string | null;
}

export interface SystemHealth {
  worker: { state: WorkerState; ageSeconds: number | null };
  // Null when the job tables could not be read (pg-boss not installed yet).
  jobs: { failed: FailedQueue[]; retrying: number } | null;
  jobsError: string | null;
  // `stuck`: still sending after 30 minutes, past the automatic recovery.
  replies: { sending: number; stuck: number; failedByReason: { reason: string; count: number }[] };
  channels: { connecting: number; timedOut: number; revoked: number };
  integrations: { accountId: string; accountName: string | null; type: string; reason: string | null; error: string | null; since: Date }[];
  // The overall verdict shown first.
  ok: boolean;
}

interface JobRow {
  name: string;
  failed: string | number;
  last_at: Date | string | null;
  last_error: string | null;
}

async function jobHealth(db: Db, since: Date): Promise<SystemHealth["jobs"]> {
  const failed = await db.execute<JobRow & Record<string, unknown>>(sql`
    select j.name,
           count(*) as failed,
           max(j.completed_on) as last_at,
           (array_agg(coalesce(j.output->>'message', j.output::text) order by j.completed_on desc))[1] as last_error
    from pgboss.job j
    where j.state = 'failed' and j.completed_on >= ${since.toISOString()}
    group by j.name
    order by failed desc`);
  const retrying = await db.execute<{ n: string | number } & Record<string, unknown>>(sql`select count(*) as n from pgboss.job where state = 'retry'`);
  return {
    failed: failed.rows.map((row) => ({
      queue: row.name,
      failed: Number(row.failed),
      lastAt: row.last_at ? new Date(row.last_at) : null,
      lastError: row.last_error ? String(row.last_error).slice(0, 300) : null,
    })),
    retrying: Number(retrying.rows[0]?.n ?? 0),
  };
}

export async function systemHealth(db: Db, now = new Date()): Promise<SystemHealth> {
  const since = new Date(now.getTime() - HEALTH_WINDOW_MS);
  const worker = evaluateHealth({ dbOk: true, lastBeatAt: await latestHeartbeat(db), now }).worker;

  let jobs: SystemHealth["jobs"] = null;
  let jobsError: string | null = null;
  try {
    jobs = await jobHealth(db, since);
  } catch (error) {
    jobsError = String(errorFields(error).error);
    log("error", "system health: job tables unreadable", errorFields(error));
  }

  const [sending] = await db.select({ n: count() }).from(replies).where(eq(replies.status, "sending"));
  const [stuck] = await db
    .select({ n: count() })
    .from(replies)
    .where(and(eq(replies.status, "sending"), lt(replies.updatedAt, new Date(now.getTime() - STUCK_SENDING_MS))));
  const failedByReason = await db
    .select({ reason: sql<string>`coalesce(${replies.statusReason}, 'unknown')`, count: count() })
    .from(replies)
    .where(and(eq(replies.status, "failed"), gte(replies.updatedAt, since)))
    .groupBy(sql`coalesce(${replies.statusReason}, 'unknown')`)
    .orderBy(desc(count()));

  const [connecting] = await db.select({ n: count() }).from(channels).where(eq(channels.status, "connecting"));
  const [timedOut] = await db
    .select({ n: count() })
    .from(channels)
    .where(and(eq(channels.status, "rejected"), eq(channels.statusReason, "connect_timeout"), gte(channels.disconnectedAt, since)));
  const [revoked] = await db.select({ n: count() }).from(channels).where(and(eq(channels.status, "revoked"), gte(channels.disconnectedAt, since)));

  const brokenIntegrations = await db
    .select({
      accountId: integrations.accountId,
      accountName: accounts.name,
      type: integrations.type,
      reason: integrations.statusReason,
      error: integrations.lastError,
      since: integrations.updatedAt,
    })
    .from(integrations)
    .innerJoin(accounts, eq(accounts.id, integrations.accountId))
    .where(and(inArray(integrations.type, ["ghl", "stripe"]), eq(integrations.status, "error")))
    .orderBy(desc(integrations.updatedAt))
    .limit(20);

  const stuckSending = stuck?.n ?? 0;
  const ok =
    worker.state === "ok" &&
    jobsError === null &&
    (jobs?.failed.length ?? 0) === 0 &&
    stuckSending === 0 &&
    (timedOut?.n ?? 0) === 0 &&
    brokenIntegrations.length === 0;

  return {
    worker,
    jobs,
    jobsError,
    replies: { sending: sending?.n ?? 0, stuck: stuckSending, failedByReason },
    channels: { connecting: connecting?.n ?? 0, timedOut: timedOut?.n ?? 0, revoked: revoked?.n ?? 0 },
    integrations: brokenIntegrations,
    ok,
  };
}
