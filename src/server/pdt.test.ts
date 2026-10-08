import { describe, expect, it } from "vitest";
import { bearerToken, checkRedirectUri, pdtRedirectOrigins, redirectWith } from "./pdt";

describe("pdtRedirectOrigins", () => {
  it("defaults to the PDT app and reads a comma list", () => {
    expect(pdtRedirectOrigins({})).toEqual(["https://dreamteam.commentclient.com"]);
    expect(pdtRedirectOrigins({ PDT_REDIRECT_ORIGINS: "https://a.example.com/x, http://evil.com, http://localhost:8000, nonsense" })).toEqual([
      "https://a.example.com",
      "http://localhost:8000",
    ]);
  });
});

describe("checkRedirectUri", () => {
  const origins = ["https://dreamteam.commentclient.com"];
  it("accepts only an allowed origin, without user info or fragment", () => {
    expect(checkRedirectUri("https://dreamteam.commentclient.com/vidrev/callback?x=1", origins)?.pathname).toBe("/vidrev/callback");
    expect(checkRedirectUri("https://dreamteam.commentclient.com.evil.com/cb", origins)).toBeNull();
    expect(checkRedirectUri("http://dreamteam.commentclient.com/cb", origins)).toBeNull();
    expect(checkRedirectUri("https://user:pw@dreamteam.commentclient.com/cb", origins)).toBeNull();
    expect(checkRedirectUri("https://dreamteam.commentclient.com/cb#frag", origins)).toBeNull();
    expect(checkRedirectUri(null, origins)).toBeNull();
  });

  it("adds the answer to the query, keeping PDT's own parameters", () => {
    const url = checkRedirectUri("https://dreamteam.commentclient.com/cb?x=1", origins)!;
    expect(redirectWith(url, { code: "c", state: "s t" })).toBe("https://dreamteam.commentclient.com/cb?x=1&code=c&state=s+t");
  });
});

describe("bearerToken", () => {
  it("reads the Authorization header", () => {
    expect(bearerToken(new Headers({ authorization: "Bearer vidrev_pat_abc" }))).toBe("vidrev_pat_abc");
    expect(bearerToken(new Headers({ authorization: "Basic abc" }))).toBeNull();
    expect(bearerToken(new Headers())).toBeNull();
  });
});
