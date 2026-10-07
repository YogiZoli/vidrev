import { createServer, type Server } from "node:http";
import { PgBoss } from "pg-boss";
import { closeDb, getDb } from "@/db/client";
import { latestHeartbeat, recordHeartbeat } from "@/db/heartbeat";
import { QUEUES } from "@/jobs/queues";
import { appVersion, env } from "@/lib/env";
import { errorFields, log } from "@/lib/log";
import { registerHandlers } from "./handlers";
import { watchdogVerdict } from "./watchdog";

const WORKER_ID = "worker";
const HEARTBEAT_QUEUE = QUEUES.heartbeat;

async function beat(): Promise<void> {
  await recordHeartbeat(getDb(), WORKER_ID, appVersion());
}

// The latest heartbeat of any worker (so a second worker during a deploy is
// not restarted), or null when the database does not answer.
async function lastBeat(): Promise<{ databaseOk: boolean; at: number }> {
  try {
    const at = await latestHeartbeat(getDb());
    return { databaseOk: true, at: at?.getTime() ?? 0 };
  } catch {
    return { databaseOk: false, at: 0 };
  }
}

// See src/worker/watchdog.ts.
function startWatchdog(isStopping: () => boolean, startedAt: number): NodeJS.Timeout {
  return setInterval(() => {
    void (async () => {
      if (isStopping()) return;
      const beatNow = await lastBeat();
      const lastBeatOkAt = Math.max(beatNow.at, startedAt);
      const verdict = watchdogVerdict({ lastBeatOkAt, now: Date.now(), databaseOk: beatNow.databaseOk });
      const fields = { lastBeatOkAt: new Date(lastBeatOkAt).toISOString(), version: appVersion() };
      if (verdict === "wait_for_database") log("error", "worker watchdog: heartbeat stale and database unreachable, waiting", fields);
      if (verdict === "restart") {
        log("error", "worker watchdog: jobs stopped running while the database answers, exiting so Railway restarts the worker", fields);
        process.exit(1);
      }
    })();
  }, 60_000);
}

// Railway health checks need an HTTP endpoint; the worker exposes a tiny
// one that reports whether pg-boss is running.
function startHealthServer(isReady: () => boolean): Server {
  const port = Number(process.env.PORT ?? 8081);
  const server = createServer((req, res) => {
    if (req.url === "/api/health") {
      const ready = isReady();
      res.writeHead(ready ? 200 : 503, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: ready ? "ok" : "starting", role: "worker", version: appVersion() }));
      return;
    }
    res.writeHead(404).end();
  });
  server.listen(port, () => log("info", "worker health server listening", { port }));
  return server;
}

async function main(): Promise<void> {
  const boss = new PgBoss({ connectionString: env().DATABASE_URL });
  boss.on("error", (error) => log("error", "pg-boss error", errorFields(error)));

  let ready = false;
  const server = startHealthServer(() => ready);

  await boss.start();
  await boss.createQueue(HEARTBEAT_QUEUE);
  await boss.schedule(HEARTBEAT_QUEUE, "* * * * *");
  await boss.work(HEARTBEAT_QUEUE, async () => {
    try {
      await beat();
    } catch (error) {
      log("error", "worker heartbeat failed", errorFields(error));
      throw error;
    }
  });
  await registerHandlers(boss);

  await beat();
  ready = true;
  log("info", "worker started", { version: appVersion() });

  let stopping = false;
  const watchdog = startWatchdog(() => stopping, Date.now());
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log("info", "worker stopping", { signal });
    ready = false;
    clearInterval(watchdog);
    await boss.stop({ graceful: true, timeout: 20_000 });
    await closeDb();
    server.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

// Anything thrown outside a job would otherwise vanish or kill the process
// without a line in the log.
process.on("unhandledRejection", (reason) => log("error", "unhandled promise rejection in worker", errorFields(reason)));
process.on("uncaughtException", (error) => {
  log("error", "uncaught exception in worker, exiting", errorFields(error));
  process.exit(1);
});

main().catch((error) => {
  log("error", "worker failed to start", errorFields(error));
  process.exit(1);
});
