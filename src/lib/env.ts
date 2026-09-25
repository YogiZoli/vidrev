import { z } from "zod";

// Only DATABASE_URL is required to boot. Feature secrets are optional here
// and checked with requireEnv() where they are used, so a missing secret
// disables one feature with a clear error instead of taking the app down.
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
  ADMIN_EMAILS: optional,
  GOOGLE_CLIENT_ID: optional,
  GOOGLE_CLIENT_SECRET: optional,
  RESEND_API_KEY: optional,
  EMAIL_FROM: optional,
  WEBSUB_SECRET: optional,
  // Platform AI key (Q-13c): a Gemini key on its own billing-enabled GCP project.
  GEMINI_PLATFORM_API_KEY: optional,
  AI_PLATFORM_MODEL: z.string().trim().min(1).default("gemini-3.1-flash-lite"),
  QUOTA_DAILY_LIMIT: z.coerce.number().int().positive().default(10000),
  RAILWAY_GIT_COMMIT_SHA: optional,
});

type OptionalKey =
  | "ENCRYPTION_KEY"
  | "AUTH_SECRET"
  | "PROVISIONING_SECRET"
  | "ADMIN_EMAILS"
  | "GOOGLE_CLIENT_ID"
  | "GOOGLE_CLIENT_SECRET"
  | "RESEND_API_KEY"
  | "EMAIL_FROM"
  | "WEBSUB_SECRET";

export function requireEnv(name: OptionalKey): string {
  const value = env()[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

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

// Absolute base URL of this app for links in emails and OAuth redirects.
export function appBaseUrl(): string {
  return (env().APP_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

export function appVersion(): string {
  return process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev";
}
