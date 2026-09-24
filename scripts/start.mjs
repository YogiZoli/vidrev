// Single start command for both Railway services: the service name decides
// the role, so web and worker share one railway.json.
import { spawn } from "node:child_process";

const role = process.env.SERVICE_ROLE ?? (process.env.RAILWAY_SERVICE_NAME === "worker" ? "worker" : "web");
const port = process.env.PORT ?? "3000";

const [cmd, args] =
  role === "worker"
    ? [process.execPath, ["dist/worker/index.mjs"]]
    : [process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", port]];

console.log(JSON.stringify({ level: "info", msg: "starting", role }));
const child = spawn(cmd, args, { stdio: "inherit" });

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
