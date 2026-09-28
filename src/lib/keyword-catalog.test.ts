import { describe, expect, it } from "vitest";
import { catalogKeyword, DEFAULT_KEYWORD, KEYWORD_CATALOG, misspellings } from "./keyword-catalog";

describe("keyword catalog", () => {
  it("starts with GUIDE as the default and has unique keywords", () => {
    expect(KEYWORD_CATALOG[0]?.keyword).toBe(DEFAULT_KEYWORD);
    expect(new Set(KEYWORD_CATALOG.map((k) => k.keyword)).size).toBe(KEYWORD_CATALOG.length);
    expect(catalogKeyword(" guide ")?.temperature).toBe("cold");
    expect(catalogKeyword("whatever")).toBeUndefined();
  });

  it("suggests the common misspellings of GUIDE", () => {
    const list = misspellings("GUIDE");
    expect(list).toEqual(expect.arrayContaining(["GUDIE", "GIUDE", "GUIED", "UGIDE", "GUIDES"]));
    expect(list).not.toContain("GUIDE");
    expect(list.length).toBeLessThanOrEqual(10);
  });

  it("keeps short words safe and never suggests another catalog keyword", () => {
    expect(misspellings("CALL")).not.toContain("CAL");
    for (const k of KEYWORD_CATALOG) {
      for (const v of misspellings(k.keyword)) expect(catalogKeyword(v)).toBeUndefined();
    }
  });
});
