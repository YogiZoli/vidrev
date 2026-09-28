import { afterEach, describe, expect, it, vi } from "vitest";
import { onRequestError } from "./instrumentation";

const context = { routerKind: "App Router", routePath: "/auth/verify", routeType: "render", renderSource: "server-rendering", revalidateReason: undefined, renderType: "dynamic" } as const;

afterEach(() => vi.restoreAllMocks());

describe("onRequestError", () => {
  it("logs where and what failed, with the digest, never the query", () => {
    const lines: string[] = [];
    vi.spyOn(console, "error").mockImplementation((line: string) => void lines.push(line));
    const error = Object.assign(new Error("boom"), { digest: "123" });
    void onRequestError(error, { path: "/auth/verify?token=secret", method: "GET", headers: {} }, context);
    const line = JSON.parse(lines[0]!);
    expect(line).toMatchObject({ level: "error", msg: "request failed", path: "/auth/verify", route: "/auth/verify", digest: "123", error: "boom" });
    expect(lines[0]).not.toContain("secret");
  });

  it("treats a visitor who left early as info, not an error", () => {
    const info: string[] = [];
    const errors: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => void info.push(line));
    vi.spyOn(console, "error").mockImplementation((line: string) => void errors.push(line));
    void onRequestError(new Error("The destination stream closed early."), { path: "/app", method: "GET", headers: {} }, context);
    expect(errors).toHaveLength(0);
    expect(JSON.parse(info[0]!)).toMatchObject({ msg: "request aborted by the client", path: "/app" });
  });
});
