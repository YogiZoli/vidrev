import { describe, expect, it } from "vitest";
import { parseVideoIds } from "./campaigns";

describe("parseVideoIds", () => {
  it("accepts ids and watch, share, Shorts and live links", () => {
    expect(
      parseVideoIds("dQw4w9WgXcQ, https://www.youtube.com/watch?v=abcdefghijk&t=3\nhttps://youtu.be/ABCDEFGHIJK https://youtube.com/shorts/12345678901"),
    ).toEqual(["dQw4w9WgXcQ", "abcdefghijk", "ABCDEFGHIJK", "12345678901"]);
  });

  it("rejects anything else", () => {
    expect(parseVideoIds("https://example.com/video")).toBeNull();
  });
});
