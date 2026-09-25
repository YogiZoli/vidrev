import { checkLaunch, summarize } from "@/lib/launch-check";

// Usage: railway run --service web npm run launch:check
// Prints names and hints only, never a value. Exit code 1 while anything is open.
const findings = checkLaunch(process.env);
for (const f of findings.filter((x) => x.level !== "ok")) console.log(`${f.level.toUpperCase().padEnd(4)} ${f.area}: ${f.item} - ${f.hint}`);
const s = summarize(findings);
console.log(`${s.ok} ok, ${s.todo} to do, ${s.warn} warnings`);
console.log(s.ready ? "Configuration is launch ready." : "Not launch ready yet.");
process.exitCode = s.ready ? 0 : 1;
