import { describe, expect, it, vi } from "vitest";
import { guarded } from "./route-guard";

vi.mock("@/lib/env", () => ({ appBaseUrl: () => "http://localhost:3000", env: () => ({ NODE_ENV: "test" }) }));

const boom = async (): Promise<Response> => {
  throw new Error("db down");
};

describe("guarded route handlers", () => {
  it("sends a failed form post to /oops with a reference and the way back, and logs the same reference", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const request = new Request("http://localhost:3000/api/campaigns", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", referer: "http://localhost:3000/app/campaigns?x=1", host: "localhost:3000" },
      body: "action=create",
    });
    const response = await guarded("/api/campaigns", boom)(request);
    expect(response.status).toBe(303);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/oops");
    const ref = location.searchParams.get("ref")!;
    expect(ref).toMatch(/^[0-9a-f]{8}$/);
    expect(location.searchParams.get("back")).toBe("/app/campaigns");
    const line = JSON.parse(String(spy.mock.calls.at(-1)![0])) as Record<string, unknown>;
    expect(line).toMatchObject({ level: "error", msg: "request failed", route: "/api/campaigns", ref, error: "db down" });
    spy.mockRestore();
  });

  it("answers an API call with JSON 500 and the reference, never a raw error", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const request = new Request("http://localhost:3000/api/replies", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const response = await guarded("/api/replies", boom)(request);
    expect(response.status).toBe(500);
    const json = (await response.json()) as { error: string };
    expect(json.error).toMatch(/Reference: [0-9a-f]{8}$/);
    spy.mockRestore();
  });

  it("ignores a referer from another site", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const request = new Request("http://localhost:3000/api/domain", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", referer: "https://evil.example/x", host: "localhost:3000" },
      body: "",
    });
    const location = new URL((await guarded("/api/domain", boom)(request)).headers.get("location")!);
    expect(location.searchParams.has("back")).toBe(false);
  });

  it("passes a normal response through untouched", async () => {
    const ok = guarded("/x", async () => new Response("fine", { status: 201 }));
    expect((await ok(new Request("http://localhost/x"))).status).toBe(201);
  });
});
