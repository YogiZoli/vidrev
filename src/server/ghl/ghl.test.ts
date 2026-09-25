import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createGhlApi, GhlApiError } from "./api";
import { buildInstallUrl, exchangeGhlCode, GhlOAuthError, refreshGhlToken, verifyGhlSignature } from "./oauth";

const client = { clientId: "abc123-lm4x9", clientSecret: "secret", redirectUri: "https://app.vidrev.app/api/oauth/ghl/callback" };

describe("install url", () => {
  it("builds the location chooser url with scopes, state and the draft version", () => {
    const url = new URL(buildInstallUrl(client, ["contacts.readonly", "contacts.write"], "st4te"));
    expect(url.origin + url.pathname).toBe("https://marketplace.gohighlevel.com/oauth/chooselocation");
    expect(url.searchParams.get("client_id")).toBe(client.clientId);
    expect(url.searchParams.get("redirect_uri")).toBe(client.redirectUri);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("contacts.readonly contacts.write");
    expect(url.searchParams.get("state")).toBe("st4te");
    expect(url.searchParams.get("version_id")).toBe("abc123");
  });

  it("leaves out version_id for a client id without a dash", () => {
    expect(new URL(buildInstallUrl({ ...client, clientId: "plain" }, [], "s")).searchParams.has("version_id")).toBe(false);
  });
});

describe("token requests", () => {
  const seen: { url: string; body: URLSearchParams }[] = [];
  const respond = (status: number, json: unknown) => async (url: string, init?: RequestInit) => {
    seen.push({ url, body: new URLSearchParams(String(init?.body)) });
    return Response.json(json, { status });
  };

  it("exchanges a code for a location token", async () => {
    const tokens = await exchangeGhlCode(client, "the-code", respond(200, { access_token: "a", refresh_token: "r", expires_in: 86399, userType: "Location", locationId: "L1" }));
    expect(tokens).toMatchObject({ access_token: "a", refresh_token: "r", locationId: "L1" });
    const { url, body } = seen.at(-1)!;
    expect(url).toBe("https://services.leadconnectorhq.com/oauth/token");
    expect(Object.fromEntries(body)).toEqual({
      client_id: client.clientId,
      client_secret: "secret",
      grant_type: "authorization_code",
      code: "the-code",
      user_type: "Location",
      redirect_uri: client.redirectUri,
    });
  });

  it("refreshes with the refresh token and reports refusals", async () => {
    await refreshGhlToken(client, "old-refresh", respond(200, { access_token: "a2", refresh_token: "r2", expires_in: 100 }));
    expect(Object.fromEntries(seen.at(-1)!.body)).toMatchObject({ grant_type: "refresh_token", refresh_token: "old-refresh", user_type: "Location" });
    await expect(refreshGhlToken(client, "dead", respond(400, { error: "invalid_grant", error_description: "revoked" }))).rejects.toMatchObject({
      name: "GhlOAuthError",
      code: "invalid_grant",
    });
    await expect(refreshGhlToken(client, "x", respond(502, {}))).rejects.toBeInstanceOf(GhlOAuthError);
  });
});

describe("webhook signature (Ed25519)", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const body = JSON.stringify({ type: "ContactCreate", locationId: "L1" });
  const signature = sign(null, Buffer.from(body), privateKey).toString("base64");

  it("accepts a valid signature over the raw body", () => {
    expect(verifyGhlSignature(body, signature, pem)).toBe(true);
  });

  it("rejects tampering, a missing or garbage signature and a foreign key", () => {
    expect(verifyGhlSignature(`${body} `, signature, pem)).toBe(false);
    expect(verifyGhlSignature(body, null, pem)).toBe(false);
    expect(verifyGhlSignature(body, "not-base64!!", pem)).toBe(false);
    expect(verifyGhlSignature(body, signature)).toBe(false);
    expect(verifyGhlSignature(body, signature, "not a pem")).toBe(false);
  });
});

describe("api client", () => {
  function recorder(respond: (path: string, init?: RequestInit) => Response) {
    const calls: { url: URL; init?: RequestInit }[] = [];
    const fetchImpl = async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      calls.push({ url, init });
      return respond(url.pathname, init);
    };
    return { calls, api: createGhlApi(fetchImpl, "tok") };
  }

  it("sends the bearer token and the version header", async () => {
    const { calls, api } = recorder(() => Response.json({ location: { name: "Acme Coaching" } }));
    expect(await api.getLocationName("L1")).toBe("Acme Coaching");
    const headers = calls[0]!.init!.headers as Record<string, string>;
    expect(calls[0]!.url.pathname).toBe("/locations/L1");
    expect(headers.authorization).toBe("Bearer tok");
    expect(headers.version).toBe("2021-07-28");
  });

  it("creates the contact field as TEXT on the contact model and unwraps the answer", async () => {
    const { calls, api } = recorder(() => Response.json({ customField: { id: "F1", name: "c2c_tid", fieldKey: "contact.c2c_tid" } }));
    expect((await api.createContactField("L1", "c2c_tid")).id).toBe("F1");
    expect(JSON.parse(String(calls[0]!.init!.body))).toEqual({ name: "c2c_tid", dataType: "TEXT", model: "contact" });
  });

  it("upserts a contact with the tracking field and adds tags separately", async () => {
    const { calls, api } = recorder((path) => (path.endsWith("/upsert") ? Response.json({ contact: { id: "C1" } }) : Response.json({ tags: ["c2c"] })));
    expect(await api.upsertContact("L1", { email: "a@b.com", customFields: [{ id: "F1", value: "k3x9Tq2mPz" }] })).toBe("C1");
    await api.addTags("C1", ["c2c", "c2c_kw_guide"]);
    expect(JSON.parse(String(calls[0]!.init!.body))).toEqual({ locationId: "L1", email: "a@b.com", customFields: [{ id: "F1", value: "k3x9Tq2mPz" }] });
    expect(calls[1]!.url.pathname).toBe("/contacts/C1/tags");
    expect(JSON.parse(String(calls[1]!.init!.body))).toEqual({ tags: ["c2c", "c2c_kw_guide"] });
  });

  it("queries won opportunities and payments the documented way", async () => {
    const { calls, api } = recorder((path) => (path.startsWith("/opportunities") ? Response.json({ opportunities: [{ id: "O1" }], meta: { nextPage: 2 } }) : Response.json({ data: [{ _id: "T1" }], totalCount: 1 })));
    expect(await api.listWonOpportunities("L1", 1)).toEqual({ opportunities: [{ id: "O1" }], hasMore: true });
    expect(calls[0]!.url.searchParams.get("location_id")).toBe("L1");
    expect(calls[0]!.url.searchParams.get("status")).toBe("won");
    await api.listTransactions("L1", { startAt: new Date("2026-09-01T00:00:00Z"), endAt: new Date("2026-09-25T00:00:00Z"), offset: 100 });
    const q = calls[1]!.url.searchParams;
    expect(calls[1]!.url.pathname).toBe("/payments/transactions");
    expect([q.get("altId"), q.get("altType"), q.get("offset"), q.get("startAt")]).toEqual(["L1", "location", "100", "2026-09-01T00:00:00.000Z"]);
  });

  it("returns null for a missing contact and throws on other errors", async () => {
    const missing = recorder(() => new Response("{}", { status: 404 }));
    expect(await missing.api.getContact("nope")).toBeNull();
    const broken = recorder(() => new Response("boom", { status: 500 }));
    await expect(broken.api.getLocationName("L1")).rejects.toBeInstanceOf(GhlApiError);
  });
});
