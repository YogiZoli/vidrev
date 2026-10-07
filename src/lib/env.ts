import { z } from "zod";

// Only DATABASE_URL is required to boot. Feature secrets are optional here
// and checked with requireEnv() where they are used, so a missing secret
// disables one feature with a clear error instead of taking the app down.
const optional = z.string().trim().min(1).optional();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  PRODUCT_NAME: z.string().trim().min(1).default("vidrev"),
  BRAND_BASE_URL: z.string().trim().url().optional(),
  APP_BASE_URL: z.string().trim().url().optional(),
  LINK_FALLBACK_BASE_URL: z.string().trim().url().optional(),
  // Where a creator manages or cancels the subscription (GHL customer portal).
  BILLING_PORTAL_URL: z.string().trim().url().optional(),
  // GoHighLevel checkout of the founding offer; the audit CTA leads here (L-12).
  FOUNDING_CHECKOUT_URL: z.string().trim().url().optional(),
  // Owner's GoHighLevel affiliate link, offered in onboarding to creators without GoHighLevel.
  GHL_AFFILIATE_URL: z.string().trim().url().optional(),
  // Secret part of the contact field name the owner's affiliate snapshot
  // carries ("vidrev_partner_<token>"); unset turns the snapshot path off (A-20).
  VIDREV_PARTNER_MARKER: z.string().trim().min(8).optional(),
  // Marketplace app "Shared secret" (SSO key): decrypts the user GoHighLevel
  // hands the embedded app; unset turns /embed sign-in off (A-22).
  GHL_SSO_KEY: z.string().trim().min(8).optional(),
  // "1" adds the page, survey and calendar scopes once the Marketplace app has them.
  GHL_DESTINATION_SCOPES: optional,
  // Comma separated account ids or emails that may choose Beast Mode, until
  // the LLC and the Google OAuth review (DECISIONS A-25).
  BEAST_MODE_ACCOUNTS: optional,
  // The 29 day prospect delete (A-27): "dry_run" (default) only lists what it
  // would delete on /admin, "on" deletes, "off" is the emergency brake.
  BEAST_DELETE: z.enum(["off", "dry_run", "on"]).default("dry_run"),
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
  // Tracked links on the creator's own domain (D-33, CC-03).
  CLOUDFLARE_API_TOKEN: optional,
  CLOUDFLARE_ZONE_ID: optional,
  CUSTOM_HOSTNAME_CNAME_TARGET: optional,
  // Spend cap (P5-11): 100 hostnames free, then 0.10 USD each; 150 = at most 5 USD a month.
  CUSTOM_HOSTNAME_LIMIT: z.coerce.number().int().nonnegative().default(150),
  // Domain Connect (D-38): our provider id defaults to the brand domain.
  DOMAIN_CONNECT_PROVIDER_ID: optional,
  DOMAIN_CONNECT_SERVICE_ID: z.string().trim().min(1).default("links"),
  DOMAIN_CONNECT_PRIVATE_KEY: optional,
  DOMAIN_CONNECT_KEY_HOST: optional,
  // GoHighLevel Private Marketplace app (Phase 6, docs/SETUP-GHL.md).
  GHL_CLIENT_ID: optional,
  GHL_CLIENT_SECRET: optional,
  // Space separated; overrides the built-in scope list without a deploy.
  GHL_SCOPES: optional,
  // PEM of HighLevel's webhook signing key, only if HighLevel rotates it.
  GHL_WEBHOOK_PUBLIC_KEY: optional,
  // Shared secret the Marketplace workflow action sends in X-Vidrev-Key (Phase 10, docs/SETUP-GHL.md).
  GHL_ACTION_SECRET: optional,
  QUOTA_DAILY_LIMIT: z.coerce.number().int().positive().default(10000),
  // Audit my channel (Phase 9): its own GCP project and API key (D-34), no OAuth.
  YT_API_KEY_AUDIT: optional,
  // The owner's own GoHighLevel Sub-account for audit leads (Private Integration key).
  OWNER_GHL_API_KEY: optional,
  OWNER_GHL_LOCATION_ID: optional,
  AUDIT_DAILY_LIMIT: z.coerce.number().int().positive().default(10000),
  // Optional Cloudflare Turnstile on the public audit form; enforced only when both are set.
  TURNSTILE_SITE_KEY: optional,
  TURNSTILE_SECRET_KEY: optional,
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

export function domainConnectConfig(): { providerId: string; serviceId: string; privateKey?: string; keyHost?: string } | null {
  const e = env();
  let providerId = e.DOMAIN_CONNECT_PROVIDER_ID;
  if (!providerId && e.BRAND_BASE_URL) providerId = new URL(e.BRAND_BASE_URL).hostname.replace(/^www\./, "");
  if (!providerId) return null;
  return {
    providerId,
    serviceId: e.DOMAIN_CONNECT_SERVICE_ID,
    // A PEM pasted on one line with literal \n escapes works too.
    privateKey: e.DOMAIN_CONNECT_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    keyHost: e.DOMAIN_CONNECT_KEY_HOST,
  };
}

// Absolute base URL of this app for links in emails and OAuth redirects.
export function appBaseUrl(): string {
  return (env().APP_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

export function appVersion(): string {
  return process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev";
}
