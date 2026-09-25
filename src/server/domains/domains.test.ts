import { describe, expect, it } from "vitest";
import { domainCheckPlan } from "@/lib/domains";
import { CloudflareError, createCustomHostname, deleteCustomHostname, getCustomHostname, isLive } from "./cloudflare";
import { cnameRecord, detectProvider, lookupCname } from "./dns";
import { reservedDomains } from "./service";

const MIN = 60_000;

describe("domainCheckPlan", () => {
  const start = new Date("2026-09-25T12:00:00Z");
  const at = (minutes: number) => new Date(start.getTime() + minutes * MIN);
  const pending = (lastCheckedAt: Date | null) => ({ status: "pending", checkStartedAt: start, lastCheckedAt });

  it("checks every minute at first, then every 10 minutes, then hourly, then gives up", () => {
    expect(domainCheckPlan(pending(null), at(0))).toEqual({ due: true });
    expect(domainCheckPlan(pending(at(5)), at(5.5))).toEqual({ due: false });
    expect(domainCheckPlan(pending(at(5)), at(6))).toEqual({ due: true });
    expect(domainCheckPlan(pending(at(60)), at(65))).toEqual({ due: false });
    expect(domainCheckPlan(pending(at(60)), at(70))).toEqual({ due: true });
    expect(domainCheckPlan(pending(at(3000)), at(3030))).toEqual({ due: false });
    expect(domainCheckPlan(pending(at(3000)), at(3060))).toEqual({ due: true });
    expect(domainCheckPlan(pending(at(0)), at(14 * 24 * 60 + 1))).toEqual({ giveUp: true });
  });

  it("rechecks live domains daily and ignores removed and failed ones", () => {
    expect(domainCheckPlan({ status: "active", checkStartedAt: start, lastCheckedAt: at(0) }, at(60))).toEqual({ due: false });
    expect(domainCheckPlan({ status: "active", checkStartedAt: start, lastCheckedAt: at(0) }, at(24 * 60))).toEqual({ due: true });
    expect(domainCheckPlan({ status: "removed", checkStartedAt: start, lastCheckedAt: null }, at(0))).toEqual({ due: false });
    expect(domainCheckPlan({ status: "failed", checkStartedAt: start, lastCheckedAt: null }, at(0))).toEqual({ due: false });
  });
});

describe("dns", () => {
  it("reads CNAME answers over DNS-over-HTTPS", async () => {
    const urls: string[] = [];
    const answers = await lookupCname(async (url) => {
      urls.push(url);
      return Response.json({ Status: 0, Answer: [{ name: "go.coach.com.", type: 5, data: "Customers.Vidrev.App." }] });
    }, "go.coach.com");
    expect(answers).toEqual(["customers.vidrev.app"]);
    expect(urls[0]).toBe("https://cloudflare-dns.com/dns-query?name=go.coach.com&type=CNAME");
  });

  it("detects the DNS provider from nameservers", () => {
    expect(detectProvider(["keaton.ns.cloudflare.com."])?.id).toBe("cloudflare");
    expect(detectProvider(["ns51.domaincontrol.com"])?.id).toBe("godaddy");
    expect(detectProvider(["dns1.registrar-servers.com"])?.id).toBe("namecheap");
    expect(detectProvider(["ns-123.awsdns-15.com"])?.id).toBe("route53");
    expect(detectProvider(["ns1.example.net"])).toBeNull();
  });

  it("builds the record relative to the registrable domain", () => {
    expect(cnameRecord("go.coach.com", "coach.com", "customers.vidrev.app")).toEqual({ type: "CNAME", name: "go", target: "customers.vidrev.app" });
    expect(cnameRecord("links.go.coach.co.uk", "coach.co.uk", "t")).toMatchObject({ name: "links.go" });
  });
});

describe("cloudflare", () => {
  const config = { apiToken: "tok", zoneId: "zone" };
  const hostname = { id: "h1", hostname: "go.coach.com", status: "pending", ssl: { status: "pending_validation" }, verification_errors: ["custom hostname does not CNAME to this zone."] };

  it("creates a custom hostname with HTTP validation", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const result = await createCustomHostname(async (url, init) => {
      calls.push({ url, init });
      return Response.json({ success: true, result: hostname });
    }, config, "go.coach.com");
    expect(calls[0]!.url).toBe("https://api.cloudflare.com/client/v4/zones/zone/custom_hostnames");
    expect(calls[0]!.init?.method).toBe("POST");
    expect(new Headers(calls[0]!.init?.headers).get("authorization")).toBe("Bearer tok");
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({
      hostname: "go.coach.com",
      ssl: { method: "http", type: "dv", settings: { min_tls_version: "1.2" } },
    });
    expect(result).toEqual({ id: "h1", hostname: "go.coach.com", status: "pending", sslStatus: "pending_validation", errors: ["custom hostname does not CNAME to this zone."] });
    expect(isLive(result)).toBe(false);
    expect(isLive({ ...result, status: "active", sslStatus: "active" })).toBe(true);
  });

  it("raises errors with codes, treats 404 as gone", async () => {
    const fail = async () => Response.json({ success: false, errors: [{ code: 1406, message: "Duplicate custom hostname found." }] }, { status: 409 });
    await expect(createCustomHostname(fail, config, "go.coach.com")).rejects.toBeInstanceOf(CloudflareError);
    const notFound = async () => Response.json({ success: false, errors: [{ code: 1436, message: "not found" }] }, { status: 404 });
    expect(await getCustomHostname(notFound, config, "h1")).toBeNull();
    await expect(deleteCustomHostname(notFound, config, "h1")).resolves.toBeUndefined();
  });
});

describe("reservedDomains", () => {
  it("collects the product's own registrable domains", () => {
    expect([...reservedDomains(["https://app.vidrev.app", "https://go.vidrev.app", undefined, "nope"])]).toEqual(["vidrev.app"]);
  });
});
