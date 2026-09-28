import Link from "next/link";
import type { ReactNode } from "react";
import { Eyebrow, Keyword } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Meta, SectionTitle } from "@/components/ui/page";
import type { AuditExamples, AuditResult } from "@/lib/audit/result";
import { MoneyGate } from "./MoneyGate";

// "See where I lose money on YouTube" result (DECISIONS L-06, L-11, L-12):
// the headline number, the people waiting (pointers only: comment text is
// never stored, P9-07), how vidrev would reply, the creator's own money
// figure, the AdSense comparison, score, keyword, links, founding CTA.

export const EARLY_CHANNEL_COMMENTS = 20;
const SAMPLE_SLUGS = ["j7Kq2aB", "p4Xw9cD", "t8Mn3eF"];
const H1 = "m-0 text-[30px] font-extrabold leading-tight tracking-[-0.02em] md:text-[40px]";

const commentUrl = (videoId: string, commentId: string) =>
  `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&lc=${encodeURIComponent(commentId)}`;

export function AuditResultV2({
  channelLabel,
  result,
  examples,
  ctaUrl,
  emailSlot,
  eyebrow = "See where I lose money on YouTube",
}: {
  channelLabel: string;
  result: AuditResult;
  examples: AuditExamples | null;
  ctaUrl: string | null;
  emailSlot?: ReactNode;
  eyebrow?: string;
}) {
  const videos = result.sample.videos;
  const buying = result.buying.unanswered;
  const questions = result.questions.unanswered;

  if (result.sample.comments < EARLY_CHANNEL_COMMENTS) {
    return (
      <div className="grid gap-5">
        <Card className="grid gap-3">
          <Eyebrow>{eyebrow}</Eyebrow>
          <h1 className={H1}>Your channel is early. Perfect place to start.</h1>
          <p className="m-0 text-lg">
            We found {result.sample.comments} public comments on the last {videos} videos of {channelLabel}: too few to count what you lose yet. Do not play for pocket money like AdSense. Aim for real money from the first comment.
          </p>
          <Button asChild pulse>
            <Link href="/audit/sample">See what this looks like on a channel with more comments</Link>
          </Button>
        </Card>
        <Cta ctaUrl={ctaUrl} />
      </div>
    );
  }

  const signals = buying > 0 ? buying : questions;
  const headline =
    buying > 0 ? (
      <>
        <span className="text-primary-600">{buying} people</span> asked how to buy. {buying === result.buying.total ? "None" : "They"} got {buying === result.buying.total ? "an answer." : "no answer."}
      </>
    ) : (
      <>
        <span className="text-primary-600">{questions} people</span> asked you a question. They got no answer.
      </>
    );
  const pointers = (buying > 0 ? examples?.buying : examples?.questions)?.slice(0, 3) ?? [];
  const titleOf = (videoId: string) => examples?.videos.find((v) => v.id === videoId)?.title || "One of your videos";
  const keyword = result.keywords[0]?.word ?? "guide";
  const ownHost = examples?.links.find((l) => l.ownDomain && l.finalHost)?.finalHost?.replace(/^www\./, "") ?? "yourdomain.com";
  const linkHost = ownHost.startsWith("go.") ? ownHost : `go.${ownHost}`;
  const factors = result.score.factors.filter((f) => f.ratio !== null);

  return (
    <div className="grid gap-5">
      <Card className="grid gap-2">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className={H1}>{headline}</h1>
        <Meta className="m-0 text-[15px]">
          {channelLabel}, last {videos} videos, {result.sample.comments} public comments. Counted from real comments, nothing estimated.
        </Meta>
      </Card>

      {pointers.length > 0 ? (
        <Card className="grid gap-3">
          <SectionTitle>They are still waiting. Answer them today.</SectionTitle>
          <ol className="m-0 grid list-none gap-3 p-0">
            {pointers.map((c, i) => (
              <li key={c.commentId} className="grid gap-1.5 rounded-xl border border-border p-4">
                <span className="text-sm font-semibold text-muted-foreground">{titleOf(c.videoId)}</span>
                <a className="font-semibold text-primary-600" href={commentUrl(c.videoId, c.commentId)} target="_blank" rel="noopener noreferrer">
                  Open the comment on YouTube
                </a>
                <div className="rounded-lg border-l-[3px] border-live bg-live-50 px-3 py-2 text-[15px]">
                  <b>vidrev would reply:</b> Here you go, {keyword === "guide" ? "the details are" : `the ${keyword} is`} here: {linkHost}/{SAMPLE_SLUGS[i]}
                </div>
              </li>
            ))}
          </ol>
          <Meta className="m-0 text-[15px]">
            Every link runs on your own domain and lands the viewer on your opt-in page. Now they are a lead with an email, not a view: an asset YouTube never gives you. You approve each reply before it goes out.
          </Meta>
        </Card>
      ) : null}

      <MoneyGate signals={signals} videos={videos}>
        <Card className="grid gap-3">
          <SectionTitle>Comment Conversion Score: {result.score.value ?? "not enough data"}{result.score.value !== null ? " of 100" : ""}</SectionTitle>
          <ul className="m-0 grid gap-1.5 pl-5 text-base">
            {factors.map((f) => (
              <li key={f.id}>
                <b>{f.label}:</b> {f.detail}
              </li>
            ))}
          </ul>
        </Card>

        <Card className="grid gap-3">
          {result.keywords[0] ? (
            <>
              <SectionTitle>Your first keyword rule</SectionTitle>
              <p className="m-0">
                <Keyword>{result.keywords[0].word}</Keyword> appears in <b>{result.keywords[0].comments} comments</b>. Say &quot;comment {result.keywords[0].word.toUpperCase()}&quot; in your next video, and vidrev replies to every one with your link.
              </p>
            </>
          ) : null}
          <SectionTitle>Your links</SectionTitle>
          <p className="m-0">
            {result.links.videosChecked - result.links.videosWithLink} of your last {result.links.videosChecked} videos have no link in the description. {result.links.linksFound - result.links.measured} of {result.links.linksFound} links are not measured.
            {result.stack.segment === "ghl" ? " Your pages run on GoHighLevel, which connects natively." : ""}
          </p>
        </Card>

        <Cta ctaUrl={ctaUrl} />
        {emailSlot}
      </MoneyGate>
    </div>
  );
}

function Cta({ ctaUrl }: { ctaUrl: string | null }) {
  return (
    <Card variant="focus" className="grid gap-3">
      <SectionTitle>Stop the leak. Founding 100: 97 USD a year, price locked for life.</SectionTitle>
      {ctaUrl ? (
        <Button asChild size="lg" pulse>
          <a href={ctaUrl}>Claim a founding seat</a>
        </Button>
      ) : (
        <Meta className="m-0">Founding seats open soon.</Meta>
      )}
    </Card>
  );
}
