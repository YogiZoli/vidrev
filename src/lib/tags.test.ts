import { describe, expect, it } from "vitest";
import { hottest, tagSlug, vidrevTags } from "./tags";

describe("tag scheme", () => {
  it("builds one tag per dimension, words written out", () => {
    expect(vidrevTags({ keyword: "GUIDE", intent: "cold", videoId: "dQw4w9WgXcQ", buyer: true })).toEqual([
      "vidrev",
      "vidrev-source-youtube",
      "vidrev-keyword-guide",
      "vidrev-temperature-cold-lead",
      "vidrev-video-dQw4w9WgXcQ",
      "vidrev-buyer",
    ]);
  });

  it("adds every clicked keyword and video from the history, and only the hottest temperature", () => {
    const tags = vidrevTags({
      keyword: "GUIDE",
      intent: "cold",
      videoId: "aaaaaaaaaaa",
      history: [
        { keyword: "CALL", intent: "hot", videoId: "bbbbbbbbbbb" },
        { keyword: "guide", intent: "cold", videoId: "aaaaaaaaaaa" },
      ],
    });
    expect(tags).toEqual([
      "vidrev",
      "vidrev-source-youtube",
      "vidrev-keyword-guide",
      "vidrev-keyword-call",
      "vidrev-temperature-hot-lead",
      "vidrev-video-aaaaaaaaaaa",
      "vidrev-video-bbbbbbbbbbb",
    ]);
    expect(hottest([{ intent: "warm" }, { intent: null }, { intent: "cold" }])).toBe("warm");
  });

  it("always has the root tag and skips what is missing", () => {
    expect(vidrevTags({})).toEqual(["vidrev"]);
    expect(vidrevTags({ keyword: "  ", videoId: "x" })).toEqual(["vidrev"]);
  });

  it("slugs keywords", () => {
    expect(tagSlug("Free Guide!")).toBe("free-guide");
    expect(tagSlug("Árvíztűrő tükörfúrógép")).toBe("arvizturo-tukorfurogep");
    expect(tagSlug("--a--b--")).toBe("a-b");
    expect(tagSlug("x".repeat(60))).toHaveLength(40);
  });

  it("keeps letters and marks of other scripts", () => {
    expect(tagSlug("คู่มือ")).toBe("คู่มือ");
    expect(tagSlug("गाइड")).toBe("गाइड");
  });
});
