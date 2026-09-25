import { describe, expect, it } from "vitest";
import { checkLaunch, summarize } from "./launch-check";

const full: Record<string, string> = Object.fromEntries(
  [
    "DATABASE_URL", "ENCRYPTION_KEY", "AUTH_SECRET", "PROVISIONING_SECRET", "ADMIN_EMAILS", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "WEBSUB_SECRET",
    "RESEND_API_KEY", "EMAIL_FROM", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ZONE_ID", "CUSTOM_HOSTNAME_CNAME_TARGET", "LINK_FALLBACK_BASE_URL",
    "GEMINI_PLATFORM_API_KEY", "YT_API_KEY_AUDIT", "GHL_CLIENT_ID", "GHL_CLIENT_SECRET", "GHL_WEBHOOK_PUBLIC_KEY",
  ].map((k) => [k, "x"]),
);
const ready = { ...full, BRAND_BASE_URL: "https://vidrev.app", APP_BASE_URL: "https://app.vidrev.app", NODE_ENV: "production" };

describe("checkLaunch", () => {
  it("passes a complete production configuration", () => {
    expect(summarize(checkLaunch(ready))).toMatchObject({ todo: 0, warn: 0, ready: true });
  });

  it("lists what is missing by name and never echoes a value", () => {
    const findings = checkLaunch({ ...ready, GEMINI_PLATFORM_API_KEY: "", YT_API_KEY_AUDIT: "secret-value" });
    expect(findings.filter((f) => f.level === "todo").map((f) => f.item)).toEqual(["GEMINI_PLATFORM_API_KEY"]);
    expect(JSON.stringify(findings)).not.toContain("secret-value");
  });

  it("warns when the app is not on the brand domain or not https", () => {
    const railway = checkLaunch({ ...ready, APP_BASE_URL: "https://web-production.up.railway.app" }).find((f) => f.item === "APP_BASE_URL");
    expect(railway?.level).toBe("warn");
    const http = checkLaunch({ ...ready, APP_BASE_URL: "http://app.vidrev.app" }).find((f) => f.item === "APP_BASE_URL");
    expect(http?.level).toBe("warn");
    const other = checkLaunch({ ...ready, APP_BASE_URL: "https://app.other.com" }).find((f) => f.item === "APP_BASE_URL");
    expect(other?.level).toBe("warn");
  });

  it("flags a missing brand url and a non-production environment", () => {
    const findings = checkLaunch({ ...ready, BRAND_BASE_URL: undefined, NODE_ENV: "development" });
    expect(findings.find((f) => f.item === "BRAND_BASE_URL")?.level).toBe("todo");
    expect(findings.find((f) => f.item === "NODE_ENV")?.level).toBe("warn");
  });
});
