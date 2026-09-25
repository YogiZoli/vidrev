import { migrate } from "drizzle-orm/node-postgres/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import * as schema from "@/db/schema";
import { seedAdminAccounts, seedPlans } from "@/db/seed";
import { parseEmailList } from "@/lib/email";
import { errorFields, log } from "@/lib/log";

// Both Railway services run this on start (scripts/start.mjs), so an advisory
// lock makes sure only one of them applies migrations at a time.
const MIGRATION_LOCK_ID = 727_001;

// Seeds (plans, owner accounts) run under the same lock, right after the
// migrations, and are idempotent.
export async function runMigrations(
  connectionString: string,
  options: { migrationsFolder?: string; adminEmails?: string[] } = {},
): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: options.migrationsFolder ?? "drizzle" });
    await seedPlans(db);
    const created = await seedAdminAccounts(db, options.adminEmails ?? []);
    if (created > 0) log("info", "owner accounts created", { count: created });
  } finally {
    await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]).catch(() => {});
    await client.end();
  }
}

const isEntrypoint = process.argv[1] !== undefined && /migrate\.(ts|mjs)$/.test(process.argv[1]);

if (isEntrypoint) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    log("error", "DATABASE_URL is not set");
    process.exit(1);
  }
  runMigrations(url, { adminEmails: parseEmailList(process.env.ADMIN_EMAILS) })
    .then(() => log("info", "migrations applied"))
    .catch((error) => {
      log("error", "migration failed", errorFields(error));
      process.exit(1);
    });
}
