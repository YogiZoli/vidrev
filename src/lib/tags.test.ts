import { describe, expect, it } from "vitest";
import { c2cTags, tagSlug } from "./tags";

describe("tag scheme", () => {
  it("builds the four tags", () => {
    expect(c2cTags({ keyword: "GUIDE", videoId: "dQw4w9WgXcQ", buyer: true })).toEqual([
      "c2c",
      "c2c_kw_guide",
      "c2c_vid_dQw4w9WgXcQ",
      "c2c_buyer",
    ]);
  });

  it("always has the root tag and skips what is missing", () => {
    expect(c2cTags({})).toEqual(["c2c"]);
    expect(c2cTags({ keyword: "  ", videoId: "x" })).toEqual(["c2c"]);
  });

  it("slugs keywords", () => {
    expect(tagSlug("Free Guide!")).toBe("free_guide");
    expect(tagSlug("Árvíztűrő tükörfúrógép")).toBe("arvizturo_tukorfurogep");
    expect(tagSlug("--a--b--")).toBe("a_b");
    expect(tagSlug("x".repeat(60))).toHaveLength(40);
  });

  it("keeps letters and marks of other scripts", () => {
    expect(tagSlug("คู่มือ")).toBe("คู่มือ");
    expect(tagSlug("गाइड")).toBe("गाइड");
  });
});
