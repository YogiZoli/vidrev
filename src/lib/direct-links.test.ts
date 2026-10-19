import { describe, expect, it } from "vitest";
import { guideSteps, providerById } from "@/server/domains/dns";
import { hostOf, publicLinkUrl, suggestHostname } from "./links";

// A-38: replies show the creator's own domain, never the fallback host.
describe("publicLinkUrl", () => {
  const base = { host: "go.vidrev.app", slug: "QmDC7Th", destinationUrl: "https://go.commentclient.com/guide?x=1", keyword: "GUIDE" };

  it("uses the short link on a live link domain", () => {
    expect(publicLinkUrl({ ...base, host: "link.commentclient.com", directTid: null })).toBe("https://link.commentclient.com/QmDC7Th");
  });

  it("uses the creator's own page with the tracking id otherwise", () => {
    const url = new URL(publicLinkUrl({ ...base, directTid: "k3x9Tq2mPz" }));
    expect(url.hostname).toBe("go.commentclient.com");
    expect(url.pathname).toBe("/guide");
    expect(url.searchParams.get("x")).toBe("1");
    expect(url.searchParams.get("vidrev_tid")).toBe("k3x9Tq2mPz");
    expect(url.searchParams.get("utm_content")).toBe("k3x9Tq2mPz");
    expect(url.searchParams.get("utm_campaign")).toBe("GUIDE");
  });

  it("hostOf", () => {
    expect(hostOf("https://Go.Example.com/x")).toBe("go.example.com");
    expect(hostOf("nope")).toBeNull();
  });
});

describe("suggestHostname skips subdomains in use", () => {
  it("never suggests the destination's own host", () => {
    expect(suggestHostname("https://go.commentclient.com/guide")).toBe("link.commentclient.com");
  });

  it("skips hosts of other destinations too", () => {
    expect(suggestHostname("https://www.coachanna.com/x", ["go.coachanna.com", null])).toBe("link.coachanna.com");
    expect(suggestHostname("https://go.coachanna.com/x", ["link.coachanna.com"])).toBe("get.coachanna.com");
  });
});

describe("guideSteps", () => {
  it("fills the Cloudflare guide with the record and a direct link", () => {
    const guide = guideSteps(providerById("cloudflare"), { domain: "commentclient.com", name: "link", target: "customers.vidrev.app" });
    expect(guide.open).toBe("https://dash.cloudflare.com/?to=/:account/commentclient.com/dns/records");
    expect(guide.steps.some((s) => s.includes("paste link"))).toBe(true);
    expect(guide.steps.some((s) => s.includes("customers.vidrev.app"))).toBe(true);
    expect(guide.steps.some((s) => s.includes("DNS only"))).toBe(true);
  });

  it("falls back to generic steps", () => {
    const guide = guideSteps(null, { domain: "example.com", name: "go", target: "customers.vidrev.app" });
    expect(guide.open).toBeNull();
    expect(guide.steps.join(" ")).toContain("example.com");
  });
});
