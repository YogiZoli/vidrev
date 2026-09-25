import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { accounts } from "@/db/schema";
import type { JobPayloads } from "@/jobs/queues";
import { log } from "@/lib/log";
import { claimReportDirty, dirtyAccounts, runAttribution } from "@/server/attribution";
import { rebuildReports } from "@/server/reports";

// Attribution and reporting (Phase 7). New data marks an account dirty
// (src/server/attribution.ts); the engine tick queues one refresh per dirty
// account; an hourly pass marks every account so periods roll over.

export interface ReportDeps {
  db: Db;
  now?: () => Date;
  enqueue: <Q extends keyof JobPayloads>(queue: Q, data: JobPayloads[Q], options?: { singletonKey?: string }) => Promise<void>;
}

export async function queueReportRefreshes(deps: ReportDeps): Promise<number> {
  const ids = await dirtyAccounts(deps.db);
  for (const accountId of ids) await deps.enqueue("report.refresh", { accountId }, { singletonKey: accountId });
  return ids.length;
}

export async function refreshAccountReports(deps: ReportDeps, accountId: string): Promise<void> {
  const startedAt = deps.now?.() ?? new Date();
  await claimReportDirty(deps.db, accountId, startedAt);
  const attribution = await runAttribution(deps.db, accountId, startedAt);
  await rebuildReports(deps.db, accountId, startedAt);
  await deps.db.update(accounts).set({ reportsComputedAt: startedAt }).where(eq(accounts.id, accountId));
  if (attribution.changed > 0) log("info", "attribution updated", { accountId, ...attribution });
}
