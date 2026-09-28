import type { JobWithMetadata } from "pg-boss";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SendEmailJob } from "@/jobs/queues";
import { HttpTimeoutError, timedFetch } from "@/lib/http";
import { errorFields } from "@/lib/log";
import { createAlerter, problemKey } from "./alerts";
import { jobRefs, runJob, runSteps } from "./jobs";

function job<T>(data: T, retryCount: number, retryLimit: number): JobWithMetadata<T> {
  return { id: "job-1", name: "q", data, retryCount, retryLimit } as unknown as JobWithMetadata<T>;
}

function captureLogs() {
  const lines: Record<string, unknown>[] = [];
  vi.spyOn(console, "error").mockImplementation((line: string) => void lines.push(JSON.parse(line)));
  vi.spyOn(console, "log").mockImplementation((line: string) => void lines.push(JSON.parse(line)));
  return lines;
}

function alerts() {
  const sent: SendEmailJob[] = [];
  let clock = new Date("2026-09-29T10:00:00Z").getTime();
  const alerter = createAlerter({
    send: async (email) => void sent.push(email),
    recipients: ["owner@example.com"],
    productName: "vidrev",
    now: () => new Date(clock),
  });
  return { alerter, sent, advance: (ms: number) => (clock += ms) };
}

afterEach(() => vi.restoreAllMocks());

describe("errorFields", () => {
  it("carries the message, type, a short stack and the wrapped cause", () => {
    const fields = errorFields(new Error("insert failed", { cause: Object.assign(new Error("duplicate key"), { code: "23505" }) }));
    expect(fields).toMatchObject({ error: "insert failed", errorType: "Error", cause: "duplicate key", code: "23505" });
    expect(String(fields.stack)).toContain("observability.test.ts");
    expect(errorFields("plain")).toEqual({ error: "plain" });
  });
});

describe("runJob", () => {
  it("logs a failed attempt with queue, job id, attempt and payload ids, and retries without an alert", async () => {
    const lines = captureLogs();
    const { alerter, sent } = alerts();
    const run = runJob<{ replyId: string; body: string }>("reply.send", alerter, async () => {
      throw new Error("boom");
    });
    await expect(run([job({ replyId: "r1", body: "secret text" }, 0, 3)])).rejects.toThrow("boom");
    const failure = lines.find((l) => l.msg === "job failed, will retry")!;
    expect(failure).toMatchObject({ queue: "reply.send", jobId: "job-1", attempt: 1, maxAttempts: 4, replyId: "r1", error: "boom" });
    expect(JSON.stringify(failure)).not.toContain("secret text");
    expect(sent).toHaveLength(0);
  });

  it("alerts the owner on the last attempt, never for the email queue itself", async () => {
    captureLogs();
    const { alerter, sent } = alerts();
    const failing = async () => {
      throw new Error("Google said no");
    };
    await expect(runJob<{ channelId: string }>("channel.sync", alerter, failing)([job({ channelId: "c1" }, 5, 5)])).rejects.toThrow();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toContain("channel.sync");
    expect(sent[0]!.text).toContain("channelId: c1");
    await expect(runJob<{ to: string }>("email.send", alerter, failing)([job({ to: "a@b.c" }, 5, 5)])).rejects.toThrow();
    expect(sent).toHaveLength(1);
  });

  it("logs a slow job", async () => {
    const lines = captureLogs();
    const { alerter } = alerts();
    let t = 0;
    await runJob<{ accountId: string }>("report.refresh", alerter, async () => void (t += 45_000), () => t)([job({ accountId: "a1" }, 0, 2)]);
    expect(lines.find((l) => l.msg === "slow job")).toMatchObject({ queue: "report.refresh", durationMs: 45_000, accountId: "a1" });
  });
});

describe("runSteps", () => {
  it("runs every step even when one fails, and names the failed step", async () => {
    const lines = captureLogs();
    const { alerter, sent } = alerts();
    const ran: string[] = [];
    const failed = await runSteps("engine.tick", alerter, [
      ["domain checks", async () => void ran.push("domains")],
      [
        "webhook retries",
        async () => {
          throw new Error("db timeout");
        },
      ],
      ["polling", async () => void ran.push("polling")],
    ]);
    expect(failed).toEqual(["webhook retries"]);
    expect(ran).toEqual(["domains", "polling"]);
    expect(lines.find((l) => l.msg === "step failed")).toMatchObject({ job: "engine.tick", step: "webhook retries", error: "db timeout" });
    expect(sent[0]!.subject).toContain('step "webhook retries" failed');
  });
});

describe("owner alerts", () => {
  it("emails once an hour per problem and counts the repeats in between", async () => {
    captureLogs();
    const { alerter, sent, advance } = alerts();
    await alerter.alert("k", "Something broke", ["line"]);
    await alerter.alert("k", "Something broke", ["line"]);
    await alerter.alert("other", "Other thing", ["line"]);
    expect(sent).toHaveLength(2);
    advance(61 * 60_000);
    await alerter.alert("k", "Something broke", ["line"]);
    expect(sent).toHaveLength(3);
    expect(sent[2]!.text).toContain("1 more time(s)");
  });

  it("groups the same problem even when ids and numbers differ", () => {
    expect(problemKey("job:q", 'Reply 4f1c2a3b-1111-2222-3333-444455556666 failed after 3 tries for "abc"')).toBe(
      problemKey("job:q", 'Reply 9e9e9e9e-aaaa-bbbb-cccc-ddddeeeeffff failed after 7 tries for "xyz"'),
    );
  });
});

describe("timedFetch", () => {
  it("turns a hang into an HttpTimeoutError that names the host", async () => {
    const hang = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)));
    await expect(timedFetch(20, hang)("https://api.example.com/x")).rejects.toBeInstanceOf(HttpTimeoutError);
    await expect(timedFetch(20, hang)("https://api.example.com/x")).rejects.toThrow("api.example.com");
  });

  it("keeps a caller's own signal", async () => {
    const own = new AbortController();
    let seen: AbortSignal | undefined;
    await timedFetch(20, async (_url, init) => {
      seen = init?.signal ?? undefined;
      return new Response("ok");
    })("https://api.example.com/x", { signal: own.signal });
    expect(seen).toBe(own.signal);
  });
});

describe("jobRefs", () => {
  it("keeps only ids", () => {
    expect(jobRefs({ replyId: "r1", to: "a@b.c", text: "hi", count: 3 })).toEqual({ replyId: "r1" });
  });
});
