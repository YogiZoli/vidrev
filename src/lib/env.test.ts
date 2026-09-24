import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

describe("parseEnv", () => {
  it("requires DATABASE_URL", () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
  });

  it("applies defaults", () => {
    const env = parseEnv({ DATABASE_URL: "postgres://u:p@localhost:5432/db" });
    expect(env.PRODUCT_NAME).toBe("ProductName");
    expect(env.QUOTA_DAILY_LIMIT).toBe(10000);
    expect(env.NODE_ENV).toBe("development");
  });

  it("coerces QUOTA_DAILY_LIMIT and rejects non-positive values", () => {
    const base = { DATABASE_URL: "postgres://u:p@localhost:5432/db" };
    expect(parseEnv({ ...base, QUOTA_DAILY_LIMIT: "50000" }).QUOTA_DAILY_LIMIT).toBe(50000);
    expect(() => parseEnv({ ...base, QUOTA_DAILY_LIMIT: "0" })).toThrow(/QUOTA_DAILY_LIMIT/);
  });

  it("rejects malformed base URLs", () => {
    expect(() =>
      parseEnv({ DATABASE_URL: "postgres://u:p@localhost:5432/db", APP_BASE_URL: "not a url" }),
    ).toThrow(/APP_BASE_URL/);
  });
});
