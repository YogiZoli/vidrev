import { describe, expect, it } from "vitest";
import { findWholeWord, type MatchableCampaign, matchComment, normalizeText } from "./keywords";

const at = new Date("2026-09-01T00:00:00Z");

function campaign(over: Partial<MatchableCampaign> & { id: string; keyword: string }): MatchableCampaign {
  return { aliases: [], intent: "warm", videoIds: null, createdAt: at, ...over };
}

function comment(text: string, videoId = "v1") {
  return { text, videoId, publishedAt: new Date("2026-09-10T00:00:00Z") };
}

describe("normalizeText", () => {
  it("lowercases, strips accents and collapses whitespace", () => {
    expect(normalizeText("  GUÍDE\n please ")).toBe("guide please");
    expect(normalizeText("ÚTMUTATÓ")).toBe("utmutato");
  });
});

describe("findWholeWord", () => {
  it("matches anywhere in the comment, as a whole word, case-insensitive", () => {
    expect(findWholeWord(normalizeText("Great video! GUIDE please"), "guide")).toBe(13);
    expect(findWholeWord(normalizeText("#guide"), "guide")).toBe(1);
    expect(findWholeWord(normalizeText("guide."), "Guide")).toBe(0);
  });

  it("does not match inside another word", () => {
    expect(findWholeWord(normalizeText("guidelines"), "guide")).toBe(-1);
    expect(findWholeWord(normalizeText("misguided"), "guide")).toBe(-1);
    expect(findWholeWord(normalizeText("guide_2"), "guide")).toBe(-1);
  });

  it("matches multi-word keywords across any whitespace", () => {
    expect(findWholeWord(normalizeText("send the  free\nguide"), "free guide")).toBe(9);
  });

  it("treats regex characters literally", () => {
    expect(findWholeWord(normalizeText("want c++ tips"), "c++")).toBe(5);
    expect(findWholeWord(normalizeText("a.b"), "a.b")).toBe(0);
    expect(findWholeWord(normalizeText("axb"), "a.b")).toBe(-1);
  });
});

describe("matchComment", () => {
  it("matches aliases", () => {
    const [m] = matchComment(comment("send me the pdf"), [campaign({ id: "c1", keyword: "guide", aliases: ["pdf"] })]);
    expect(m).toMatchObject({ campaignId: "c1", keyword: "guide", position: 12 });
  });

  it("orders several matches: intent, then video scope, then position (Q-10b)", () => {
    const campaigns = [
      campaign({ id: "cold", keyword: "free", intent: "cold" }),
      campaign({ id: "warm-first", keyword: "guide" }),
      campaign({ id: "warm-scoped", keyword: "course", videoIds: ["v1"] }),
      campaign({ id: "hot", keyword: "price", intent: "hot" }),
    ];
    const ids = matchComment(comment("free guide and course, what is the price"), campaigns).map((m) => m.campaignId);
    expect(ids).toEqual(["hot", "warm-scoped", "warm-first", "cold"]);
  });

  it("prefers the keyword appearing first on a full tie", () => {
    const ids = matchComment(comment("course or guide"), [
      campaign({ id: "guide", keyword: "guide" }),
      campaign({ id: "course", keyword: "course" }),
    ]).map((m) => m.campaignId);
    expect(ids).toEqual(["course", "guide"]);
  });

  it("ignores campaigns scoped to other videos and comments older than the campaign", () => {
    expect(matchComment(comment("guide", "v2"), [campaign({ id: "c", keyword: "guide", videoIds: ["v1"] })])).toEqual([]);
    const late = campaign({ id: "c", keyword: "guide", createdAt: new Date("2026-09-20T00:00:00Z") });
    expect(matchComment(comment("guide"), [late])).toEqual([]);
  });
});
