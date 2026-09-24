import { z } from "zod";

// Only DATABASE_URL is required so far. Each later phase makes its own
// variables required as the feature that needs them is built.
const optional = z.string().trim().min(1).optional();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  PRODUCT_NAME: z.string().trim().min(1).default("ProductName"),
  BRAND_BASE_URL: z.string().url().optional(),
  APP_BASE_URL: z.string().url().optional(),
  LINK_FALLBACK_BASE_URL: z.string().url().optional(),
  ENCRYPTION_KEY: optional,
  AUTH_SECRET: optional,
  PROVISIONING_SECRET: optional,
  QUOTA_DAILY_LIMIT: z.coerce.number().int().positive().default(10000),
  RAILWAY_GIT_COMMIT_SHA: optional,
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment: ${problems}`);
  }
  return result.data;
}

let cached: Env | undefined;

// Parsed lazily so `next build` does not need runtime secrets.
export function env(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

export function appVersion(): string {
  return process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev";
}
