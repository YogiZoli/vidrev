import { describe, expect, it } from "vitest";
import { detectLanguage, pickReplyLanguage } from "./language";

describe("detectLanguage", () => {
  it("detects longer comments", () => {
    expect(detectLanguage("Hola, me gustaría recibir la guía por favor")).toBe("es");
    expect(detectLanguage("Szia, kérem szépen az útmutatót, köszönöm")).toBe("hu");
  });

  it("returns null for comments too short to detect", () => {
    expect(detectLanguage("guide please")).toBeNull();
  });
});

describe("pickReplyLanguage (B-06)", () => {
  it("uses the commenter's language only when a template exists in it", () => {
    expect(pickReplyLanguage({ commentLanguage: "es", channelDefault: "en", templateLanguages: ["en", "es"] })).toBe("es");
    expect(pickReplyLanguage({ commentLanguage: "es", channelDefault: "hu", templateLanguages: ["en", "hu"] })).toBe("hu");
  });

  it("falls back to English when the default language has no template", () => {
    expect(pickReplyLanguage({ commentLanguage: "es", channelDefault: "hu", templateLanguages: ["en"] })).toBe("en");
  });

  it("uses the channel default when there are no templates at all", () => {
    expect(pickReplyLanguage({ commentLanguage: null, channelDefault: "hu", templateLanguages: [] })).toBe("hu");
  });
});
