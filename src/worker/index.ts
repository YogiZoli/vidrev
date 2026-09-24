import { createServer, type Server } from "node:http";
import { PgBoss } from "pg-boss";
import { closeDb, getDb } from "@/db/client";
import { recordHeartbeat } from "@/db/heartbeat";
import { appVersion, env } from "@/lib/env";
import { log } from "@/lib/log";

const WORKER_ID = "worker";
const HEARTBEAT_QUEUE = "system.heartbeat";

async function beat(): Promise<void> {
  await recordHeartbeat(getDb(), WORKER_ID, appVersion());
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
  boss.on("error", (error) => log("error", "pg-boss error", { error: String(error) }));

  let ready = false;
  const server = startHealthServer(() => ready);

  await boss.start();
  await boss.createQueue(HEARTBEAT_QUEUE);
  await boss.schedule(HEARTBEAT_QUEUE, "* * * * *");
  await boss.work(HEARTBEAT_QUEUE, async () => {
    await beat();
  });

  await beat();
  ready = true;
  log("info", "worker started", { version: appVersion() });

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log("info", "worker stopping", { signal });
    ready = false;
    await boss.stop({ graceful: true, timeout: 20_000 });
    await closeDb();
    server.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error) => {
  log("error", "worker failed to start", { error: String(error) });
  process.exit(1);
});
