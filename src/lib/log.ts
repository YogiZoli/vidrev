type Level = "debug" | "info" | "warn" | "error";

// Structured one-line JSON logs; Railway indexes the fields.
export function log(level: Level, msg: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ level, msg, time: new Date().toISOString(), ...fields });
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

// Drizzle wraps driver errors; the useful part (pg code, message) sits in
// `cause`, so log both levels.
export function errorFields(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { error: String(error) };
  const cause = error.cause as { message?: string; code?: string } | undefined;
  return {
    error: error.message.split("\n")[0],
    ...(cause ? { cause: cause.message, code: cause.code } : {}),
  };
}
