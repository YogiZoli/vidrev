import { and, eq, gte, sql } from "drizzle-orm";
import { closeDb, getDb } from "@/db/client";
import { channels, quotaLedger } from "@/db/schema";
import { sizeQuota } from "@/lib/quota-sizing";

// Prints the sizing table for the quota extension request from the real ledger
// of the shared product project. Usage: npm run quota:report -- [days=14]
async function main() {
  const days = Math.max(1, Number(process.argv[2] ?? 14) || 14);
  const db = getDb();
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const rows = await db
    .select({ datePt: sql<string>`${quotaLedger.datePt}::text`, method: quotaLedger.method, units: quotaLedger.units })
    .from(quotaLedger)
    .where(and(eq(quotaLedger.gcpProject, "app"), gte(quotaLedger.datePt, since)));
  const [active] = await db.select({ n: sql<number>`count(*)::int` }).from(channels).where(eq(channels.status, "connected"));
  const sizing = sizeQuota(rows, active?.n ?? 0);

  console.log(`Quota ledger, project "app", last ${days} days (${sizing.days} days with calls), ${sizing.activeChannels} connected channels`);
  console.log(`Total ${sizing.totalUnits} units, average ${sizing.averageDayUnits} a day, peak ${sizing.peakDayUnits} a day`);
  for (const m of sizing.byMethod) console.log(`  ${m.method.padEnd(24)} ${String(m.units).padStart(8)} units  ${(m.share * 100).toFixed(1)}%`);
  if (sizing.unitsPerChannelPerDay === null) {
    console.log("Not enough data: connect a channel and let it run for a few days, then run this again.");
  } else {
    console.log(`Per connected channel: about ${sizing.unitsPerChannelPerDay} units a day`);
    for (const p of sizing.projection) console.log(`  ${String(p.channels).padStart(4)} channels: ${p.unitsPerDay} units a day`);
    console.log(`Suggested request for 100 channels with 30% headroom: ${sizing.suggestedRequest} units a day`);
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
