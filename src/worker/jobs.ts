import type { JobWithMetadata } from "pg-boss";
import { errorFields, log } from "@/lib/log";
import { type Alerter, problemKey } from "./alerts";

// Jobs slower than this are logged, so a slow external service shows up
// before it becomes a timeout.
export const SLOW_JOB_MS = 30_000;

// Queues whose final failure is only logged, never emailed: an email about
// the email queue failing would fail the same way.
const NO_EMAIL_ALERT = new Set(["email.send"]);

// The ids in a payload (channelId, replyId...), safe to log. Other fields can
// hold personal data (an email address, a message), so they are left out.
export function jobRefs(data: unknown): Record<string, string> {
  if (!data || typeof data !== "object") return {};
  const refs: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    if (key.endsWith("Id") && typeof value === "string") refs[key] = value;
  }
  return refs;
}

// Wraps a queue handler: every failure is logged with the queue, job id,
// attempt, the payload ids and the error with its stack; the last failed
// attempt also alerts the owner. The error is re-thrown so pg-boss retries.
export function runJob<T>(queue: string, alerter: Alerter, handler: (job: JobWithMetadata<T>) => Promise<void>, now: () => number = Date.now) {
  return async (jobs: JobWithMetadata<T>[]): Promise<void> => {
    for (const job of jobs) {
      const started = now();
      const attempt = job.retryCount + 1;
      const refs = jobRefs(job.data);
      try {
        await handler(job);
        const durationMs = now() - started;
        if (durationMs >= SLOW_JOB_MS) log("warn", "slow job", { queue, jobId: job.id, durationMs, ...refs });
      } catch (error) {
        const final = job.retryCount >= job.retryLimit;
        const fields = errorFields(error);
        log("error", final ? "job failed for good" : "job failed, will retry", {
          queue,
          jobId: job.id,
          attempt,
          maxAttempts: job.retryLimit + 1,
          durationMs: now() - started,
          ...refs,
          ...fields,
        });
        if (final && !NO_EMAIL_ALERT.has(queue)) {
          await alerter.alert(problemKey(`job:${queue}`, String(fields.error)), `Job ${queue} failed for good`, [
            `Queue: ${queue}`,
            `Job: ${job.id} (attempt ${attempt} of ${job.retryLimit + 1})`,
            ...Object.entries(refs).map(([key, value]) => `${key}: ${value}`),
            `Error: ${String(fields.errorType ?? "")} ${String(fields.error)}`,
            ...(fields.cause ? [`Cause: ${String(fields.cause)} ${String(fields.code ?? "")}`] : []),
            ...(fields.stack ? [`Where: ${String(fields.stack).split(" | ").slice(0, 3).join(" <- ")}`] : []),
          ]);
        }
        throw error;
      }
    }
  };
}

// A scheduled job made of independent steps (engine tick, retention, hourly
// pass): each step runs even when an earlier one fails, each failure is logged
// with the step name and alerts the owner (throttled). Returns the failed step
// names; the scheduled job itself does not fail, so nothing is logged twice.
export async function runSteps(
  name: string,
  alerter: Alerter,
  steps: [step: string, run: () => Promise<unknown>][],
  now: () => number = Date.now,
): Promise<string[]> {
  const failed: string[] = [];
  for (const [step, run] of steps) {
    const started = now();
    try {
      await run();
      const durationMs = now() - started;
      if (durationMs >= SLOW_JOB_MS) log("warn", "slow step", { job: name, step, durationMs });
    } catch (error) {
      failed.push(step);
      const fields = errorFields(error);
      log("error", "step failed", { job: name, step, durationMs: now() - started, ...fields });
      await alerter.alert(problemKey(`step:${name}:${step}`, String(fields.error)), `${name}: step "${step}" failed`, [
        `Job: ${name}`,
        `Step: ${step}`,
        `Error: ${String(fields.errorType ?? "")} ${String(fields.error)}`,
        ...(fields.cause ? [`Cause: ${String(fields.cause)} ${String(fields.code ?? "")}`] : []),
        ...(fields.stack ? [`Where: ${String(fields.stack).split(" | ").slice(0, 3).join(" <- ")}`] : []),
        "The other steps of this run continued.",
      ]);
    }
  }
  return failed;
}
