import { createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { applyUrl, discoverDomainConnect } from "./domain-connect";

const config = { providerId: "vidrev.app", serviceId: "links" };

function provider(supported: boolean) {
  const urls: string[] = [];
  const fetchFn = async (url: string) => {
    urls.push(url);
    if (url.startsWith("https://cloudflare-dns.com/")) {
      return Response.json({ Status: 0, Answer: [{ name: "_domainconnect.coach.com", type: 16, data: '"api.domainconnect.example"' }] });
    }
    if (url === "https://api.domainconnect.example/v2/coach.com/settings") {
      return Response.json({ providerId: "example", providerName: "Example DNS", urlSyncUX: "https://dcc.example/", urlAPI: "https://api.domainconnect.example" });
    }
    if (url === "https://api.domainconnect.example/v2/domainTemplates/providers/vidrev.app/services/links") {
      return supported ? Response.json({}) : new Response("", { status: 404 });
    }
    return new Response("", { status: 404 });
  };
  return { fetchFn, urls };
}

describe("discoverDomainConnect", () => {
  it("finds the provider when it supports our template", async () => {
    expect(await discoverDomainConnect(provider(true).fetchFn, "coach.com", config)).toEqual({
      providerId: "example",
      providerName: "Example DNS",
      urlSyncUX: "https://dcc.example",
    });
  });

  it("returns null when the template is not onboarded or there is no record", async () => {
    expect(await discoverDomainConnect(provider(false).fetchFn, "coach.com", config)).toBeNull();
    const none = async () => Response.json({ Status: 3 });
    expect(await discoverDomainConnect(none, "coach.com", config)).toBeNull();
  });
});

describe("applyUrl", () => {
  it("builds an unsigned URL without redirect_uri", () => {
    expect(applyUrl({ urlSyncUX: "https://dcc.example" }, config, { registrable: "coach.com", host: "go", redirectUri: "https://app.vidrev.app/app/settings/domain" })).toBe(
      "https://dcc.example/v2/domainTemplates/providers/vidrev.app/services/links/apply?domain=coach.com&host=go",
    );
  });

  it("signs the query with the private key", () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const signed = { ...config, privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(), keyHost: "_dck1" };
    const url = new URL(applyUrl({ urlSyncUX: "https://dcc.example" }, signed, { registrable: "coach.com", host: "go", redirectUri: "https://app.vidrev.app/app/settings/domain", state: "s1" }));
    const query = url.search.slice(1);
    const unsignedPart = query.slice(0, query.indexOf("&sig="));
    expect(unsignedPart).toBe("domain=coach.com&host=go&redirect_uri=https%3A%2F%2Fapp.vidrev.app%2Fapp%2Fsettings%2Fdomain&state=s1");
    expect(url.searchParams.get("key")).toBe("_dck1");
    const ok = createVerify("RSA-SHA256").update(unsignedPart).verify(publicKey, url.searchParams.get("sig")!, "base64");
    expect(ok).toBe(true);
  });
});
