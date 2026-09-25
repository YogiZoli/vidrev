import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildAuthUrl,
  createPkcePair,
  exchangeCode,
  GoogleOAuthError,
  grantedYoutubeScope,
  revokeToken,
  YOUTUBE_SCOPE,
} from "./oauth";

const client = { clientId: "cid", clientSecret: "csecret", redirectUri: "https://app.example/api/oauth/google/callback" };

function fakeFetch(status: number, body: unknown, calls: { url: string; init?: RequestInit }[] = []) {
  return async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
}

describe("buildAuthUrl", () => {
  it("asks only for the allowed scopes, offline access and PKCE", () => {
    const url = new URL(buildAuthUrl(client, "state123", "challenge456"));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("scope")).toBe(`openid email profile ${YOUTUBE_SCOPE}`);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("state123");
    expect(url.searchParams.get("code_challenge")).toBe("challenge456");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe(client.redirectUri);
  });
});

describe("createPkcePair", () => {
  it("derives the S256 challenge from the verifier", () => {
    const { verifier, challenge } = createPkcePair();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
  });
});

describe("exchangeCode", () => {
  it("posts the code with the PKCE verifier", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const tokens = await exchangeCode(
      client,
      "code1",
      "verifier1",
      fakeFetch(200, { access_token: "at", expires_in: 3599, refresh_token: "rt", scope: YOUTUBE_SCOPE, token_type: "Bearer" }, calls),
    );
    expect(tokens.refresh_token).toBe("rt");
    const sent = new URLSearchParams(String(calls[0]!.init!.body));
    expect(sent.get("code_verifier")).toBe("verifier1");
    expect(sent.get("grant_type")).toBe("authorization_code");
  });

  it("surfaces Google's error code", async () => {
    await expect(exchangeCode(client, "bad", "v", fakeFetch(400, { error: "invalid_grant" }))).rejects.toMatchObject({
      code: "invalid_grant",
    });
    await expect(exchangeCode(client, "bad", "v", fakeFetch(400, { error: "invalid_grant" }))).rejects.toBeInstanceOf(GoogleOAuthError);
  });
});

describe("revokeToken", () => {
  it("treats an already invalid token as revoked", async () => {
    await expect(revokeToken("t", fakeFetch(400, { error: "invalid_token" }))).resolves.toBeUndefined();
  });

  it("throws on other failures", async () => {
    await expect(revokeToken("t", fakeFetch(500, {}))).rejects.toBeInstanceOf(GoogleOAuthError);
  });
});

describe("grantedYoutubeScope", () => {
  it("detects a missing YouTube permission (granular consent)", () => {
    expect(grantedYoutubeScope(`openid ${YOUTUBE_SCOPE} email`)).toBe(true);
    expect(grantedYoutubeScope("openid email profile")).toBe(false);
  });
});
