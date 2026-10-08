import { describe, expect, it } from "vitest";
import { RETURN_COOKIE, returnCookie, safeReturnPath, takeReturnPath } from "./return-to";

function store(value?: string) {
  const jar = new Map<string, string>(value ? [[RETURN_COOKIE, value]] : []);
  return { jar, get: (name: string) => (jar.has(name) ? { value: jar.get(name)! } : undefined), delete: (name: string) => jar.delete(name) };
}

describe("return-to", () => {
  it("accepts only the PDT connect page", () => {
    expect(safeReturnPath("/connect/pdt?redirect_uri=x&state=y")).toBe("/connect/pdt?redirect_uri=x&state=y");
    expect(safeReturnPath("/connect/pdt")).toBe("/connect/pdt");
    expect(safeReturnPath("//evil.com")).toBeNull();
    expect(safeReturnPath("https://evil.com/connect/pdt")).toBeNull();
    expect(safeReturnPath("/app")).toBeNull();
  });

  it("returns the signed path once, else the fallback", () => {
    const cookie = returnCookie("/connect/pdt?state=1", "secret", true);
    const jar = store(cookie.value);
    expect(takeReturnPath(jar, "secret")).toBe("/connect/pdt?state=1");
    expect(jar.jar.size).toBe(0);
    expect(takeReturnPath(store(cookie.value), "other secret")).toBe("/app");
    expect(takeReturnPath(store(), "secret")).toBe("/app");
  });
});
