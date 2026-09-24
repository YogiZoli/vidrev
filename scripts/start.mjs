// Single start command for both Railway services: the service name decides
// the role, so web and worker share one railway.json. Migrations run first
// on every start; the migrate script holds a Postgres advisory lock, so the
// two services never apply them at the same time.
import { spawn, spawnSync } from "node:child_process";

const role = process.env.SERVICE_ROLE ?? (process.env.RAILWAY_SERVICE_NAME === "worker" ? "worker" : "web");
const port = process.env.PORT ?? "3000";

console.log(JSON.stringify({ level: "info", msg: "starting", role }));

const migration = spawnSync(process.execPath, ["dist/scripts/migrate.mjs"], { stdio: "inherit" });
if (migration.status !== 0) {
  console.error(JSON.stringify({ level: "error", msg: "migrations failed, not starting", role }));
  process.exit(1);
}

const args =
  role === "worker"
    ? ["dist/worker/index.mjs"]
    : ["node_modules/next/dist/bin/next", "start", "-p", port];
const child = spawn(process.execPath, args, { stdio: "inherit" });

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
