import { describe, expect, it } from "vitest";
import {
  classifyUserAgent,
  cookieDomain,
  destinationWithTid,
  hashIp,
  isApex,
  isSlug,
  newSlug,
  newTid,
  normalizeHostname,
  randomId,
  suggestHostname,
  tidCookie,
} from "./links";
import { linkHostOf } from "./link-host";

describe("ids", () => {
  it("makes slugs and tids of the right shape", () => {
    expect(isSlug(newSlug())).toBe(true);
    expect(newTid()).toMatch(/^[2-9a-zA-Z]{10}$/);
    expect(isSlug("abc")).toBe(false);
    expect(isSlug("abc/def")).toBe(false);
    expect(isSlug("0O1lI00")).toBe(false);
  });

  it("skips biased bytes", () => {
    let calls = 0;
    const bytes = (n: number) => {
      calls += 1;
      return Buffer.alloc(n, calls === 1 ? 255 : 3);
    };
    expect(randomId(4, bytes)).toBe("5555");
  });
});

describe("destinationWithTid", () => {
  it("appends vidrev_tid and UTM and keeps existing parameters", () => {
    const url = new URL(destinationWithTid("https://e.com/optin?ref=a&utm_source=x", { tid: "T1", keyword: "guide" }));
    expect(url.searchParams.get("ref")).toBe("a");
    expect(url.searchParams.get("vidrev_tid")).toBe("T1");
    expect(url.searchParams.get("utm_source")).toBe("vidrev");
    expect(url.searchParams.get("utm_medium")).toBe("comment");
    expect(url.searchParams.get("utm_campaign")).toBe("guide");
    expect(url.searchParams.get("utm_content")).toBe("T1");
  });

  it("leaves the destination untouched without a tid", () => {
    expect(destinationWithTid("https://e.com/optin?ref=a", { tid: null, keyword: "g" })).toBe("https://e.com/optin?ref=a");
  });
});

describe("classifyUserAgent", () => {
  it("separates bots and devices", () => {
    expect(classifyUserAgent("Mozilla/5.0 (compatible; Googlebot/2.1)")).toBe("bot");
    expect(classifyUserAgent("facebookexternalhit/1.1")).toBe("bot");
    expect(classifyUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148")).toBe("mobile");
    expect(classifyUserAgent("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)")).toBe("tablet");
    expect(classifyUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130")).toBe("desktop");
    expect(classifyUserAgent(null)).toBe("unknown");
  });
});

describe("hashIp", () => {
  it("changes with the day and never returns the ip", () => {
    const a = hashIp("1.2.3.4", "s", "2026-09-25");
    expect(a).not.toContain("1.2.3.4");
    expect(a).toBe(hashIp("1.2.3.4", "s", "2026-09-25"));
    expect(a).not.toBe(hashIp("1.2.3.4", "s", "2026-09-26"));
    expect(hashIp(null, "s", "d")).toBeNull();
  });
});

describe("cookieDomain and tidCookie", () => {
  it("finds the registrable domain", () => {
    expect(cookieDomain("go.example.com")).toBe("example.com");
    expect(cookieDomain("go.example.co.uk")).toBe("example.co.uk");
    expect(cookieDomain("localhost")).toBeNull();
    expect(cookieDomain("1.2.3.4")).toBeNull();
  });

  it("sets a secure first-party cookie on the parent domain", () => {
    const cookie = tidCookie("T1", "go.example.com");
    expect(cookie).toContain("vidrev_tid=T1");
    expect(cookie).toContain("Domain=example.com");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
  });
});

describe("hostnames", () => {
  it("normalizes input", () => {
    expect(normalizeHostname(" Go.Example.com. ")).toBe("go.example.com");
    expect(normalizeHostname("https://go.example.com/path")).toBe("go.example.com");
    expect(normalizeHostname("go_example.com")).toBeNull();
    expect(normalizeHostname("1.2.3.4")).toBeNull();
    expect(normalizeHostname("")).toBeNull();
  });

  it("rejects apex domains", () => {
    expect(isApex("example.com")).toBe(true);
    expect(isApex("example.co.uk")).toBe(true);
    expect(isApex("go.example.com")).toBe(false);
  });

  it("suggests go.<domain> from the destination, never a platform domain", () => {
    expect(suggestHostname("https://www.coachanna.com/free-guide")).toBe("go.coachanna.com");
    expect(suggestHostname("https://anna.systeme.io/guide")).toBeNull();
    expect(suggestHostname("https://link.leadconnectorhq.com/widget/form/x")).toBeNull();
    expect(suggestHostname("not a url")).toBeNull();
  });
});

describe("linkHostOf", () => {
  const headers = (h: Record<string, string>) => new Headers(h);
  it("uses X-Original-Host from Cloudflare", () => {
    expect(linkHostOf(headers({ host: "web.up.railway.app", "x-original-host": "Go.Example.com" }), "go.vidrev.app", "app.vidrev.app")).toBe("go.example.com");
  });
  it("accepts the fallback host directly", () => {
    expect(linkHostOf(headers({ host: "go.vidrev.app:443" }), "go.vidrev.app", "app.vidrev.app")).toBe("go.vidrev.app");
  });
  it("treats everything else as the app", () => {
    expect(linkHostOf(headers({ host: "app.vidrev.app" }), "go.vidrev.app", "app.vidrev.app")).toBeNull();
    expect(linkHostOf(headers({ host: "x", "x-original-host": "app.vidrev.app" }), "go.vidrev.app", "app.vidrev.app")).toBeNull();
  });
});
