import { describe, expect, it } from "vitest";
import { checkSchemaId, maxCardBytes, validateCard, validateCardBytes } from "./publishing-card";

const CARD_ID = "3f2b8c1e-4a5d-4e6f-8a9b-0c1d2e3f4a5b";
const card = (extra: Record<string, unknown> = {}) => ({ schema: "video-publishing-card/1", cardId: CARD_ID, ...extra });

describe("validateCard", () => {
  it("accepts the two required fields and keeps the raw card", () => {
    const result = validateCard(card({ futureField: { kept: true } }));
    expect(result).toMatchObject({ ok: true, summary: { cardId: CARD_ID, landingUrl: null, calls: [] } });
    if (result.ok) expect(result.raw.futureField).toEqual({ kept: true });
  });

  it("refuses another major version and a missing schema with PDT's sentences", () => {
    expect(checkSchemaId("video-publishing-card/1.3")).toBeNull();
    expect(checkSchemaId("video-publishing-card/2")).toContain("format version 2");
    expect(validateCard({ cardId: CARD_ID })).toEqual({ ok: false, errors: [expect.stringContaining('"schema" must read "video-publishing-card/1"')] });
    expect(validateCard(card({ cardId: "nope" }))).toEqual({ ok: false, errors: ['"cardId" is required and must be a UUID.'] });
    expect(validateCard([])).toEqual({ ok: false, errors: ["The card must be a JSON object."] });
  });

  it("reads comment calls: upper case keyword, first mention wins, offer as data", () => {
    const result = validateCard(
      card({
        landingUrl: "https://example.com/guide",
        video: { title: "My video", seconds: 600, language: "en" },
        commentCalls: [
          { slot: "start", keyword: "guide", temperature: "cold", gets: " the free guide ", start: 12 },
          { slot: "end", keyword: "GUIDE", temperature: "hot" },
          { slot: "end", keyword: "CALL2", temperature: "hot", gets: null },
        ],
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      summary: {
        landingUrl: "https://example.com/guide",
        title: "My video",
        calls: [
          { keyword: "GUIDE", temperature: "cold", gets: "the free guide" },
          { keyword: "CALL2", temperature: "hot", gets: null },
        ],
      },
    });
  });

  it("lists every problem", () => {
    const result = validateCard(
      card({
        landingUrl: "ftp://x",
        video: { seconds: 30 },
        commentCalls: [
          { slot: "start", keyword: "two words", temperature: "cold" },
          { slot: "later", keyword: "GUIDE", temperature: "cold" },
          { slot: "start", keyword: "GUIDE", temperature: "cold", start: 90 },
        ],
        syntheticMedia: "yes",
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual([
        '"landingUrl" must be a web address starting with http:// or https://.',
        "commentCalls[0]: keyword must be 2 to 20 capital letters or digits, with no spaces.",
        'commentCalls[1]: slot must be "start", "middle" or "end".',
        "commentCalls[2]: start must be a time inside the video.",
        '"syntheticMedia" must be true or false.',
      ]);
    }
  });

  it("refuses more than 10 comment calls", () => {
    const calls = Array.from({ length: 11 }, () => ({ slot: "start", keyword: "GUIDE", temperature: "cold" }));
    expect(validateCard(card({ commentCalls: calls }))).toEqual({ ok: false, errors: ['"commentCalls" must be a list of at most 10 items.'] });
  });
});

describe("validateCardBytes", () => {
  it("checks size, then JSON, then the rules", () => {
    expect(validateCardBytes("x".repeat(2048), 1024)).toEqual({ ok: false, errors: ["The card is too large (2 KB, the limit is 1 KB)."] });
    expect(validateCardBytes("{not json")).toEqual({ ok: false, errors: ["This file is not valid JSON."] });
    expect(validateCardBytes(`﻿${JSON.stringify(card())}`).ok).toBe(true);
  });

  it("uses PDT's limit and its override", () => {
    expect(maxCardBytes({})).toBe(2 * 1024 * 1024);
    expect(maxCardBytes({ CARD_MAX_BYTES: "5000" })).toBe(5000);
    expect(maxCardBytes({ CARD_MAX_BYTES: "abc" })).toBe(2 * 1024 * 1024);
  });
});
