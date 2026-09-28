import { analyzeComments, type AuditThread } from "./comments";
import type { AuditExamples, AuditResult } from "./result";
import { buildResult } from "./score";

// Sample audit for /audit/sample: an invented channel run through the real
// rule-based analysis and scoring, so the page shows what a report looks like.
// No YouTube data is involved.

const CREATOR = "UC_sample_creator";
const VIDEOS = [
  { id: "sample01", title: "How I got my first 10 coaching clients from YouTube" },
  { id: "sample02", title: "My exact funnel: from video to booked call" },
  { id: "sample03", title: "3 email mistakes that cost me sales" },
  { id: "sample04", title: "The pricing page that doubled my conversions" },
  { id: "sample05", title: "Behind the scenes of a 5-figure launch" },
];

const TEXTS: [string, boolean][] = [
  ["How much does your coaching program cost?", false],
  ["Where can I get the template you showed?", false],
  ["Is there a link to the course?", false],
  ["I want to buy this, how do I sign up?", false],
  ["Do you offer a payment plan?", true],
  ["What tool do you use for the emails?", false],
  ["Can I get the checklist please", false],
  ["How do I join the program?", false],
  ["Great video, thanks!", false],
  ["This helped a lot", false],
  ["Where do I sign up for the workshop?", true],
  ["Does this work for small channels?", false],
  ["template please", false],
  ["Loved the part about pricing", false],
  ["Can you share the funnel template?", false],
  ["What's the price of the mastermind?", false],
  ["Is the course still open?", true],
  ["checklist please", false],
  ["Super useful", false],
  ["How long did it take to see results?", true],
];

function threads(): AuditThread[] {
  const out: AuditThread[] = [];
  for (let v = 0; v < VIDEOS.length; v += 1) {
    for (let i = 0; i < TEXTS.length; i += 1) {
      if ((i + v) % 3 === 0 && v > 0) continue;
      const [text, answered] = TEXTS[i]!;
      out.push({
        videoId: VIDEOS[v]!.id,
        commentId: `c${v}${i}`,
        text,
        authorChannelId: `UC_viewer_${v}_${i}`,
        totalReplyCount: answered ? 1 : 0,
        replyAuthorIds: answered ? [CREATOR] : [],
      });
    }
  }
  return out;
}

export function sampleAudit(): { channelTitle: string; result: AuditResult; examples: AuditExamples } {
  const analysis = analyzeComments(threads(), CREATOR);
  const links = { videosChecked: 5, videosWithLink: 3, linksFound: 4, linksChecked: 4, measured: 1, ownDomain: 2 };
  const result = buildResult({
    analysis,
    links,
    detected: [{ id: "ghl", label: "GoHighLevel", category: "crm", evidence: "sample" }],
    videos: VIDEOS.length,
    commentsOffVideos: 0,
  });
  const examples: AuditExamples = {
    channelTitle: "Sample Coaching Channel",
    videos: VIDEOS,
    questions: analysis.questionExamples,
    buying: analysis.buyingExamples,
    links: [
      { url: "https://go.samplecoach.com/free-guide", finalHost: "go.samplecoach.com", measured: null, ownDomain: true, stacks: ["GoHighLevel"] },
      { url: "https://samplecoach.com/?utm_source=youtube", finalHost: "samplecoach.com", measured: "utm", ownDomain: true, stacks: ["GoHighLevel"] },
      { url: "https://linktr.ee/samplecoach", finalHost: "linktr.ee", measured: null, ownDomain: false, stacks: [] },
      { url: "https://www.amazon.com/dp/sample", finalHost: "www.amazon.com", measured: null, ownDomain: false, stacks: [] },
    ],
  };
  return { channelTitle: examples.channelTitle!, result, examples };
}
