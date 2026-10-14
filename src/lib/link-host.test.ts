import { afterEach, describe, expect, it } from "vitest";
import { brandHost, brandHostOf, fallbackHost } from "./link-host";

describe("fallbackHost", () => {
  const saved = process.env.LINK_FALLBACK_BASE_URL;
  afterEach(() => {
    process.env.LINK_FALLBACK_BASE_URL = saved;
  });

  it("reads a value pasted with a BOM or spaces", () => {
    process.env.LINK_FALLBACK_BASE_URL = "﻿https://go.example.com ";
    expect(fallbackHost()).toBe("go.example.com");
  });
});

describe("brandHostOf", () => {
  const saved = { brand: process.env.BRAND_BASE_URL, app: process.env.APP_BASE_URL };
  const restore = (key: string, value: string | undefined) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };
  afterEach(() => {
    restore("BRAND_BASE_URL", saved.brand);
    restore("APP_BASE_URL", saved.app);
  });
  const h = (host: string, original?: string) => new Headers(original ? { host, "x-original-host": original } : { host });

  it("matches the apex and its www, including a BOM-pasted value", () => {
    process.env.BRAND_BASE_URL = "\uFEFFhttps://vidrev.app ";
    process.env.APP_BASE_URL = "https://app.vidrev.app";
    expect(brandHost()).toBe("vidrev.app");
    expect(brandHostOf(h("vidrev.app"))).toBe("vidrev.app");
    expect(brandHostOf(h("WWW.vidrev.app:443"))).toBe("www.vidrev.app");
    expect(brandHostOf(h("web.up.railway.app", "vidrev.app"))).toBe("vidrev.app");
  });

  it("never matches the app host or a link host", () => {
    process.env.BRAND_BASE_URL = "https://vidrev.app";
    process.env.APP_BASE_URL = "https://app.vidrev.app";
    expect(brandHostOf(h("app.vidrev.app"))).toBeNull();
    expect(brandHostOf(h("go.vidrev.app"))).toBeNull();
    expect(brandHostOf(h("go.creator.com"))).toBeNull();
  });

  it("is off when the brand is unset or equals the app host", () => {
    process.env.APP_BASE_URL = "https://vidrev.app";
    process.env.BRAND_BASE_URL = "https://www.vidrev.app";
    expect(brandHost()).toBeNull();
    delete process.env.BRAND_BASE_URL;
    expect(brandHostOf(h("vidrev.app"))).toBeNull();
  });
});
