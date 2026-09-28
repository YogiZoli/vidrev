import { describe, expect, it } from "vitest";
import { sampleAudit } from "./sample";

describe("sampleAudit", () => {
  it("runs the real analysis into a full result", () => {
    const { result } = sampleAudit();
    expect(result.sample.videos).toBe(5);
    expect(result.buying.unanswered).toBeGreaterThan(0);
    expect(result.questions.unanswered).toBeGreaterThan(0);
    expect(result.score.value).not.toBeNull();
    expect(result.findings.length).toBeGreaterThan(3);
  });
});
