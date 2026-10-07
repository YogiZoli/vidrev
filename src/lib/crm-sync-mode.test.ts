import { describe, expect, it } from "vitest";
import { beastModeAllowed, effectiveCrmSyncMode, parseBeastAllowlist, parseCrmSyncMode } from "./crm-sync-mode";

describe("crm sync mode", () => {
  it("parses only the two modes", () => {
    expect(parseCrmSyncMode("clean")).toBe("clean");
    expect(parseCrmSyncMode("beast")).toBe("beast");
    expect(parseCrmSyncMode("BEAST")).toBeNull();
    expect(parseCrmSyncMode("")).toBeNull();
  });

  it("matches the allowlist by account id or email, ignoring case and spaces", () => {
    const list = parseBeastAllowlist(" Owner@Example.com, 0f6c1e2a-aaaa-bbbb-cccc-000000000001 ");
    expect(beastModeAllowed(list, { id: "x", emails: ["owner@example.com"] })).toBe(true);
    expect(beastModeAllowed(list, { id: "0F6C1E2A-AAAA-BBBB-CCCC-000000000001", emails: [] })).toBe(true);
    expect(beastModeAllowed(list, { id: "x", emails: ["other@example.com"] })).toBe(false);
  });

  it("allows nobody when the list is empty or unset", () => {
    expect(beastModeAllowed(parseBeastAllowlist(undefined), { id: "x", emails: ["a@b.co"] })).toBe(false);
    expect(beastModeAllowed(parseBeastAllowlist(" , "), { id: "x", emails: [""] })).toBe(false);
  });

  it("acts as Clean Mode when a saved Beast Mode is no longer allowed", () => {
    expect(effectiveCrmSyncMode("beast", true)).toBe("beast");
    expect(effectiveCrmSyncMode("beast", false)).toBe("clean");
    expect(effectiveCrmSyncMode("clean", true)).toBe("clean");
  });
});
