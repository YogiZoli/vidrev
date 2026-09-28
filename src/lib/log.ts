type Level = "debug" | "info" | "warn" | "error";

// Structured one-line JSON logs; Railway indexes the fields.
export function log(level: Level, msg: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ level, msg, time: new Date().toISOString(), ...fields });
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

// How many stack lines a log line carries: enough to see where it failed.
const STACK_LINES = 8;

// The fields of any thrown value, for a log line: the message, the error
// class, where it was thrown (short stack) and, because drizzle and fetch
// wrap the real error, the cause (pg code, message) as well.
export function errorFields(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { error: String(error) };
  const cause = error.cause as { message?: string; code?: string; name?: string } | undefined;
  const stack = error.stack
    ?.split("\n")
    .slice(1, STACK_LINES + 1)
    .map((line) => line.trim())
    .join(" | ");
  return {
    error: error.message.split("\n")[0],
    errorType: error.name,
    ...(stack ? { stack } : {}),
    ...(cause ? { cause: cause.message ?? String(cause), code: cause.code, causeType: cause.name } : {}),
  };
}
