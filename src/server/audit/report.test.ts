import { describe, expect, it } from "vitest";
import { failureText, maskEmail } from "@/lib/audit/view";
import type { AuditExamples, AuditResult } from "@/lib/audit/result";
import { auditReportEmail } from "@/server/email/templates";
import { verifyTurnstile } from "./report";

const result: AuditResult = {
  version: 1,
  sample: { videos: 5, comments: 120, commentsOffVideos: 0 },
  questions: { total: 10, answered: 4, unanswered: 6, unknown: 0 },
  buying: { total: 5, answered: 1, unanswered: 4, unknown: 0 },
  keywords: [{ word: "guide", comments: 7 }],
  links: { videosChecked: 5, videosWithLink: 4, linksFound: 3, linksChecked: 3, measured: 0, ownDomain: 2 },
  stack: { segment: "ghl", detected: [{ id: "ghl", label: "GoHighLevel", category: "crm" }] },
  score: {
    value: 41,
    factors: [
      { id: "questions_answered", label: "Questions you answered", weight: 30, ratio: 0.4, detail: "4 of 10 questions have a reply from you" },
      { id: "links_measured", label: "Description links that are measured", weight: 20, ratio: null, detail: "No links found" },
    ],
  },
  findings: [{ id: "unanswered_buying", strength: 104, text: "4 comments look like buying signals (price, link, how to join) and have no reply from you." }],
};

const examples: AuditExamples = {
  channelTitle: "Coach <Jane>",
  videos: [{ id: "vid1", title: "Video one" }],
  questions: [],
  buying: [{ videoId: "vid1", commentId: "Ugx123" }],
  links: [{ url: "https://go.coach.com/guide", finalHost: "go.coach.com", measured: null, ownDomain: true, stacks: ["GoHighLevel"] }],
};

const input = {
  to: "jane@example.com",
  productName: "vidrev",
  auditUrl: "https://app.vidrev.app/audit/abc",
  learnMoreUrl: "https://vidrev.app/?utm_source=audit",
  channelLabel: "Coach <Jane>",
  auditedAt: new Date("2026-09-26T10:00:00Z"),
  result,
  examples,
};

describe("auditReportEmail", () => {
  it("shows the score with its factors, findings, links and comment pointers", () => {
    const mail = auditReportEmail(input);
    expect(mail.to).toBe("jane@example.com");
    expect(mail.subject).toContain("Coach <Jane>");
    expect(mail.text).toContain("Comment Conversion Score: 41 out of 100");
    expect(mail.text).toContain("Questions you answered: 40% (4 of 10 questions have a reply from you)");
    expect(mail.text).toContain("Description links that are measured: not enough data");
    expect(mail.text).toContain("4 comments look like buying signals");
    expect(mail.text).toContain('"guide": 7 different comments');
    expect(mail.text).toContain("Video one: https://www.youtube.com/watch?v=vid1&lc=Ugx123");
    expect(mail.text).toContain("https://go.coach.com/guide (not measured; your own domain; runs on GoHighLevel)");
    expect(mail.text).toContain("connects natively");
    expect(mail.text).toContain("read on 2026-09-26");
  });

  it("escapes what came from outside in the HTML", () => {
    const mail = auditReportEmail(input);
    expect(mail.html).toContain("Coach &#60;Jane&#62;");
    expect(mail.html).not.toContain("<Jane>");
  });

  it("says so when there is no score and leaves out the button without a brand URL", () => {
    const mail = auditReportEmail({ ...input, learnMoreUrl: null, result: { ...result, score: { value: null, factors: [] }, stack: { segment: "other", detected: [] } } });
    expect(mail.text).toContain("not enough data for a score");
    expect(mail.text).toContain("any CRM or form tool");
    expect(mail.html).not.toContain("See how vidrev works");
  });
});

describe("view helpers", () => {
  it("masks the email and falls back to a generic failure text", () => {
    expect(maskEmail("jane@example.com")).toBe("j***@example.com");
    expect(maskEmail("nonsense")).toBe("your email");
    expect(failureText("busy")).toContain("capacity");
    expect(failureText("never-heard-of-it")).toContain("Something went wrong");
    expect(failureText(null)).toContain("Something went wrong");
  });
});

describe("verifyTurnstile", () => {
  const respond = (success: boolean) => async () => new Response(JSON.stringify({ success }));

  it("passes only on a successful verification", async () => {
    expect(await verifyTurnstile("secret", "token", "1.2.3.4", respond(true))).toBe(true);
    expect(await verifyTurnstile("secret", "token", "1.2.3.4", respond(false))).toBe(false);
  });

  it("fails closed without a token or when the check cannot be made", async () => {
    expect(await verifyTurnstile("secret", null, "1.2.3.4", respond(true))).toBe(false);
    expect(
      await verifyTurnstile("secret", "token", "1.2.3.4", async () => {
        throw new Error("network");
      }),
    ).toBe(false);
  });
});
