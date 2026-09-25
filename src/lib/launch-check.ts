// Pre-launch check of the production configuration (Phase 12). Pure: takes the
// environment as a map and returns findings. Never returns a value, only names.

export type Level = "ok" | "todo" | "warn";

export interface Finding {
  area: string;
  item: string;
  level: Level;
  hint: string;
}

type Env = Record<string, string | undefined>;

const has = (env: Env, name: string) => Boolean(env[name]?.trim());

function present(env: Env, area: string, names: string[], hint: string): Finding[] {
  return names.map((name) => ({ area, item: name, level: has(env, name) ? "ok" : "todo", hint }));
}

export function checkLaunch(env: Env): Finding[] {
  const out: Finding[] = [];
  out.push(...present(env, "Core", ["DATABASE_URL", "ENCRYPTION_KEY", "AUTH_SECRET", "PROVISIONING_SECRET", "ADMIN_EMAILS"], "Railway variable on web and worker"));
  out.push(...present(env, "Google sign-in and YouTube", ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "WEBSUB_SECRET"], "docs/compliance/OAUTH-VERIFICATION.md, section 1"));
  out.push(...present(env, "Email", ["RESEND_API_KEY", "EMAIL_FROM"], "Resend sending domain on the brand domain, so sign-in mail reaches reviewers"));
  out.push(...present(env, "Tracked links", ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ZONE_ID", "CUSTOM_HOSTNAME_CNAME_TARGET", "LINK_FALLBACK_BASE_URL"], "docs/SETUP-CLOUDFLARE.md"));
  out.push(...present(env, "AI drafts", ["GEMINI_PLATFORM_API_KEY"], "Key on a billing-enabled GCP project (Q-13c), otherwise Google may train on the data"));
  out.push(...present(env, "Audit my channel", ["YT_API_KEY_AUDIT"], "docs/SETUP-AUDIT.md"));
  out.push(...present(env, "GoHighLevel", ["GHL_CLIENT_ID", "GHL_CLIENT_SECRET", "GHL_WEBHOOK_PUBLIC_KEY"], "docs/SETUP-GHL.md"));

  const brand = env.BRAND_BASE_URL?.trim();
  out.push({
    area: "Compliance",
    item: "BRAND_BASE_URL",
    level: !brand ? "todo" : brand.startsWith("https://") ? "ok" : "warn",
    hint: "Public https URL of the brand site; the Privacy Policy and Terms live at /privacy and /terms there",
  });
  const app = env.APP_BASE_URL?.trim();
  let appLevel: Level = "ok";
  let appHint = "App host is on the brand domain over https";
  if (!app) {
    appLevel = "todo";
    appHint = "Set APP_BASE_URL";
  } else if (!app.startsWith("https://")) {
    appLevel = "warn";
    appHint = "Google review needs https";
  } else if (/\.up\.railway\.app/.test(app) || (brand && new URL(app).hostname.split(".").slice(-2).join(".") !== new URL(brand).hostname.split(".").slice(-2).join("."))) {
    appLevel = "warn";
    appHint = "Move the app to app.<brand domain> so the OAuth consent screen, privacy policy and app share one domain (compliance pack section 1, item 4)";
  }
  out.push({ area: "Compliance", item: "APP_BASE_URL", level: appLevel, hint: appHint });
  if (env.NODE_ENV && env.NODE_ENV !== "production") out.push({ area: "Core", item: "NODE_ENV", level: "warn", hint: "Not production" });
  return out;
}

export function summarize(findings: Finding[]): { ok: number; todo: number; warn: number; ready: boolean } {
  const count = (level: Level) => findings.filter((f) => f.level === level).length;
  return { ok: count("ok"), todo: count("todo"), warn: count("warn"), ready: count("todo") === 0 && count("warn") === 0 };
}
