import { PgBoss } from "pg-boss";
import { env } from "@/lib/env";
import { errorFields, log } from "@/lib/log";
import { type JobPayloads, QUEUE_OPTIONS } from "./queues";

// The web service only produces jobs: no supervision and no cron, which the
// worker owns. One started instance per process.
let bossPromise: Promise<PgBoss> | undefined;

async function startProducer(): Promise<PgBoss> {
  const boss = new PgBoss({ connectionString: env().DATABASE_URL, supervise: false, schedule: false, max: 2 });
  boss.on("error", (error) => log("error", "pg-boss producer error", errorFields(error)));
  await boss.start();
  // createQueue is idempotent; creating here means web never depends on the
  // worker having started first.
  for (const [name, options] of Object.entries(QUEUE_OPTIONS)) {
    await boss.createQueue(name, options);
  }
  return boss;
}

export async function enqueue<Q extends keyof JobPayloads>(queue: Q, data: JobPayloads[Q]): Promise<void> {
  bossPromise ??= startProducer().catch((error: unknown) => {
    bossPromise = undefined;
    throw error;
  });
  const boss = await bossPromise;
  await boss.send(queue, data as object);
}
