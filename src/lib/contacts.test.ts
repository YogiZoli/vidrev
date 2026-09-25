import { describe, expect, it } from "vitest";
import { earlier, identityKeys, later, maxStage, pickWinner } from "./contacts";

describe("identityKeys", () => {
  it("normalises emails by trimming and lowercasing only", () => {
    expect(identityKeys({ email: "  Jane.Doe+news@Example.COM " })).toEqual([{ kind: "email", value: "jane.doe+news@example.com" }]);
  });

  it("collects every key once and skips empty ones", () => {
    const keys = identityKeys({ youtubeChannel: "UC1", email: "a@b.co", ghlContact: "g1", stripeCustomer: "", commentFallback: "c1" });
    expect(keys.map((k) => k.kind)).toEqual(["youtube_channel", "email", "ghl_contact"]);
  });

  it("uses the comment id only when there is no channel id", () => {
    expect(identityKeys({ commentFallback: "c1" })).toEqual([{ kind: "comment", value: "c1" }]);
    expect(identityKeys({ youtubeChannel: "UC1", commentFallback: "c1" })).toEqual([{ kind: "youtube_channel", value: "UC1" }]);
  });
});

describe("stages and winners", () => {
  it("never moves the stage back", () => {
    expect(maxStage("buyer", "commenter")).toBe("buyer");
    expect(maxStage("commenter", "subscriber")).toBe("subscriber");
    expect(maxStage("subscriber", "subscriber")).toBe("subscriber");
  });

  it("picks the earliest Contact, id breaking ties", () => {
    const at = (s: string) => new Date(s);
    expect(pickWinner([{ id: "b", firstSeenAt: at("2026-01-02") }, { id: "a", firstSeenAt: at("2026-01-03") }]).winner.id).toBe("b");
    const tie = pickWinner([{ id: "z", firstSeenAt: at("2026-01-02") }, { id: "m", firstSeenAt: at("2026-01-02") }]);
    expect(tie.winner.id).toBe("m");
    expect(tie.losers.map((l) => l.id)).toEqual(["z"]);
  });

  it("takes the earlier and later of two possibly empty times", () => {
    const a = new Date("2026-01-01");
    const b = new Date("2026-02-01");
    expect(earlier(a, b)).toBe(a);
    expect(later(a, b)).toBe(b);
    expect(earlier(null, b)).toBe(b);
    expect(later(a, null)).toBe(a);
    expect(earlier(null, null)).toBeNull();
  });
});
