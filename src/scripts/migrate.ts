import { migrate } from "drizzle-orm/node-postgres/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { errorFields, log } from "@/lib/log";

// Both Railway services run this on start (scripts/start.mjs), so an advisory
// lock makes sure only one of them applies migrations at a time.
const MIGRATION_LOCK_ID = 727_001;

export async function runMigrations(connectionString: string, migrationsFolder = "drizzle"): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
    await migrate(drizzle(client), { migrationsFolder });
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
  runMigrations(url)
    .then(() => log("info", "migrations applied"))
    .catch((error) => {
      log("error", "migration failed", errorFields(error));
      process.exit(1);
    });
}
