import { describe, expect, it } from "vitest";
import { analyzeComments, type AuditThread, isBuyingIntent, isQuestion } from "./comments";
import { parseChannelInput } from "./handle";
import { extractLinks, isOwnDomain, measuredBy } from "./links";
import { buildFindings, buildResult, PREVIEW_FINDINGS, scoreFactors, scoreValue } from "./score";
import { detectStack, segmentOf } from "./stack";

const ME = "UCcreator0000000000000000";

function thread(text: string, over: Partial<AuditThread> = {}): AuditThread {
  return { videoId: "v1", commentId: `c-${text.length}-${Math.random()}`, text, authorChannelId: "UCviewer", totalReplyCount: 0, replyAuthorIds: [], ...over };
}

describe("parseChannelInput", () => {
  it("accepts handles, URLs and channel ids", () => {
    expect(parseChannelInput("@Coach.Jane")).toMatchObject({ ok: true, ref: { kind: "handle", handle: "@Coach.Jane", key: "handle:coach.jane" } });
    expect(parseChannelInput("coachjane")).toMatchObject({ ok: true, ref: { kind: "handle", key: "handle:coachjane" } });
    expect(parseChannelInput("https://www.youtube.com/@coachjane/videos")).toMatchObject({ ok: true, ref: { kind: "handle", handle: "@coachjane" } });
    expect(parseChannelInput("youtube.com/channel/UCabcdefghijklmnopqrstuv")).toMatchObject({ ok: true, ref: { kind: "id", id: "UCabcdefghijklmnopqrstuv" } });
    expect(parseChannelInput("UCabcdefghijklmnopqrstuv")).toMatchObject({ ok: true, ref: { kind: "id" } });
    expect(parseChannelInput("https://m.youtube.com/user/OldName")).toMatchObject({ ok: true, ref: { kind: "username", key: "username:oldname" } });
  });

  it("refuses custom /c/ URLs, other hosts and junk", () => {
    expect(parseChannelInput("https://youtube.com/c/Something")).toMatchObject({ ok: false });
    expect(parseChannelInput("https://evil.example/@coachjane")).toMatchObject({ ok: false });
    expect(parseChannelInput("https://youtube.com/channel/notanid")).toMatchObject({ ok: false });
    expect(parseChannelInput("")).toMatchObject({ ok: false });
    expect(parseChannelInput("a b")).toMatchObject({ ok: false });
  });

  it("gives the same cache key for every spelling of one handle", () => {
    const a = parseChannelInput("@CoachJane");
    const b = parseChannelInput("https://youtube.com/@coachjane");
    expect(a.ok && b.ok && a.ref.key === b.ref.key).toBe(true);
  });
});

describe("comment classification", () => {
  it("finds questions", () => {
    expect(isQuestion("Which mic is that?")).toBe(true);
    expect(isQuestion("how do you edit the intro so fast")).toBe(true);
    expect(isQuestion("Great video")).toBe(false);
    expect(isQuestion("How?")).toBe(true);
  });

  it("finds buying signals and ignores praise", () => {
    expect(isBuyingIntent("How much is the course?")).toBe(true);
    expect(isBuyingIntent("Where can I buy this template")).toBe(true);
    expect(isBuyingIntent("Link please!")).toBe(true);
    expect(isBuyingIntent("I'm interested, sign me up")).toBe(true);
    expect(isBuyingIntent("Do you offer coaching?")).toBe(true);
    expect(isBuyingIntent("Great video, thanks for sharing")).toBe(false);
    expect(isBuyingIntent("I love the way you explain this")).toBe(false);
  });
});

describe("analyzeComments", () => {
  it("tallies reply state from what YouTube returned", () => {
    const threads = [
      thread("How much is it?"),
      thread("How much is the program?", { totalReplyCount: 1, replyAuthorIds: [ME] }),
      thread("What is the price?", { totalReplyCount: 9, replyAuthorIds: ["UCother"] }),
      thread("Price?", { totalReplyCount: 1, replyAuthorIds: ["UCother"] }),
      thread("How much for me?", { authorChannelId: ME }),
    ];
    const result = analyzeComments(threads, ME);
    expect(result.comments).toBe(4);
    expect(result.buying).toEqual({ total: 4, answered: 1, unanswered: 2, unknown: 1 });
    expect(result.buyingExamples).toHaveLength(2);
  });

  it("proposes repeated words as keyword candidates, without filler words", () => {
    const texts = ["send the guide please", "guide link?", "I need the guide", "great video thanks", "checklist please"];
    const result = analyzeComments(texts.map((t) => thread(t)), ME);
    expect(result.keywords[0]).toEqual({ word: "guide", comments: 3 });
    expect(result.keywords.map((k) => k.word)).not.toContain("please");
    expect(result.keywords.map((k) => k.word)).not.toContain("great");
  });

  it("stores nothing but ids for examples", () => {
    const result = analyzeComments([thread("Where can I buy this?", { commentId: "abc" })], ME);
    expect(result.buyingExamples).toEqual([{ videoId: "v1", commentId: "abc" }]);
    expect(JSON.stringify(result)).not.toContain("Where can I buy");
  });
});

describe("links", () => {
  it("extracts offer links and skips social hosts", () => {
    const text = "Free guide: https://coach.com/guide?utm_source=yt.\nFollow https://instagram.com/x and https://youtu.be/abc\nhttps://coach.com/guide?utm_source=yt";
    expect(extractLinks(text)).toEqual(["https://coach.com/guide?utm_source=yt"]);
    expect(extractLinks(null)).toEqual([]);
  });

  it("tells measured links from bare ones", () => {
    expect(measuredBy("https://coach.com/a?utm_source=youtube")).toBe("utm");
    expect(measuredBy("https://coach.com/a?c2c_tid=abc")).toBe("utm");
    expect(measuredBy("https://bit.ly/3xyz")).toBe("click_tracker");
    expect(measuredBy("https://coach.com/a")).toBeNull();
  });

  it("knows platform hosts from own domains", () => {
    expect(isOwnDomain("go.coach.com")).toBe(true);
    expect(isOwnDomain("coach.mykajabi.com")).toBe(false);
    expect(isOwnDomain("linktr.ee")).toBe(false);
    expect(isOwnDomain("notkit.com")).toBe(true);
  });
});

describe("detectStack", () => {
  it("counts GoHighLevel only on the creator's own page", () => {
    const own = detectStack({ finalUrl: "https://coach.com/optin", body: '<script src="https://widgets.leadconnectorhq.com/loader.js">', cnames: [] });
    expect(own.map((d) => d.id)).toEqual(["ghl"]);
    const affiliate = detectStack({ finalUrl: "https://www.gohighlevel.com/?fp_ref=coach", body: "leadconnectorhq msgsndr", cnames: [] });
    expect(affiliate.map((d) => d.id)).not.toContain("ghl");
  });

  it("recognises a GoHighLevel custom domain by its CNAME", () => {
    const found = detectStack({ finalUrl: "https://go.coach.com/x", body: "", cnames: ["sites.ludicrous.cloud"] });
    expect(found).toEqual([expect.objectContaining({ id: "ghl", evidence: "go.coach.com points to sites.ludicrous.cloud" })]);
  });

  it("finds other stacks and ignores a bare tracking script", () => {
    expect(detectStack({ finalUrl: "https://coach.com/", body: "https://f.convertkit.com/x", cnames: [] }).map((d) => d.id)).toEqual(["kit"]);
    expect(detectStack({ finalUrl: "https://coach.com/", body: '<script src="//js.hs-scripts.com/1.js">', cnames: [] })).toEqual([]);
    expect(detectStack({ finalUrl: "https://amzn.to/abc", body: "", cnames: [] }).map((d) => d.id)).toEqual(["amazon"]);
  });

  it("segments GoHighLevel users apart", () => {
    const ghl = detectStack({ finalUrl: "https://coach.com/", body: "msgsndr", cnames: [] });
    expect(segmentOf(ghl, 1)).toBe("ghl");
    expect(segmentOf([], 2)).toBe("other");
    expect(segmentOf([], 0)).toBe("none");
  });
});

describe("score and findings", () => {
  const links = { videosChecked: 5, videosWithLink: 4, linksFound: 4, linksChecked: 4, measured: 1, ownDomain: 3 };

  it("weights the scored factors and leaves out the ones without data", () => {
    const analysis = analyzeComments(
      [
        thread("How does this work?", { totalReplyCount: 1, replyAuthorIds: [ME] }),
        thread("How do I start?", { totalReplyCount: 1, replyAuthorIds: [ME] }),
        thread("Which one is best?"),
        thread("How much is it?"),
        thread("Price?"),
      ],
      ME,
    );
    const factors = scoreFactors(analysis, links);
    // questions 2 of 5 (0.4, weight 30), buying 0 of 2 (0, weight 30), coverage 0.8 (20), measured 0.25 (20)
    expect(scoreValue(factors)).toBe(Math.round(((0.4 * 30 + 0 * 30 + 0.8 * 20 + 0.25 * 20) / 100) * 100));
    const sparse = scoreFactors(analyzeComments([], ME), { ...links, linksFound: 0, measured: 0 });
    // only link coverage has data: 20 of 100 weight is below the threshold
    expect(scoreValue(sparse)).toBeNull();
  });

  it("ranks findings and keeps the preview to the strongest three", () => {
    const analysis = analyzeComments(
      [thread("How much is the course?"), thread("Price please?"), thread("How does it work?"), thread("guide link"), thread("guide please"), thread("send the guide")],
      ME,
    );
    const findings = buildFindings({ analysis, links: { ...links, videosWithLink: 5, measured: 0 }, detected: [], videos: 5, commentsOffVideos: 0 });
    expect(findings.map((f) => f.id).slice(0, PREVIEW_FINDINGS)).toEqual(["unanswered_buying", "unmeasured_links", "unanswered_questions"]);
    expect(findings[0]!.text).toContain("2 comments look like buying signals");
  });

  it("reports honestly when there are no comments", () => {
    const result = buildResult({ analysis: analyzeComments([], ME), links: { ...links, videosWithLink: 5, measured: 4 }, detected: [], videos: 5, commentsOffVideos: 5 });
    expect(result.findings[0]).toMatchObject({ id: "no_comments" });
    expect(result.findings[0]!.text).toContain("turned off");
    expect(result.score.value).not.toBeNull();
  });
});
