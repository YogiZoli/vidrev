import Script from "next/script";
import { Eyebrow } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Meta, PublicCard } from "@/components/ui/page";
import { env } from "@/lib/env";
import { Notice, productName } from "../ui";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  origin: "That request did not come from this page. Please try again.",
  rate: "Too many audits from your address in the last hour. Please try again later.",
  human: "We could not confirm you are human. Please try again.",
  server: "Something went wrong. Please try again in a moment.",
};

// Audit my channel (SPEC section 13): free, no sign-in, real numbers only.
export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const { TURNSTILE_SITE_KEY, TURNSTILE_SECRET_KEY } = env();
  const turnstile = TURNSTILE_SITE_KEY && TURNSTILE_SECRET_KEY ? TURNSTILE_SITE_KEY : null;
  const error = params.error === "input" ? (params.msg ?? "Paste your @handle or the channel URL.") : params.error ? ERRORS[params.error] : null;

  return (
    <PublicCard width="md">
      <Eyebrow>Free audit</Eyebrow>
      <h1 className="m-0 text-[28px] font-bold leading-tight tracking-[-0.016em]">Audit my channel</h1>
      <p className="m-0 text-base text-ink-2">
        See what your comments are worth. We read your last 5 videos and tell you, with real numbers, which questions and buying signals went unanswered and whether your links are measured.
      </p>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <form method="post" action="/api/audit" className="grid gap-3">
        <Label htmlFor="channel">Your @handle or channel URL</Label>
        <Input id="channel" name="channel" required maxLength={300} placeholder="@yourchannel" autoComplete="off" large />
        {turnstile ? <div className="cf-turnstile" data-sitekey={turnstile} /> : null}
        <Button type="submit" size="lg" pulse>
          Audit my channel
        </Button>
      </form>
      {turnstile ? <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" /> : null}
      <Meta>
        Free, no sign-in. Only public data is read, comment text is never stored, and nothing is posted to your channel. {productName()} does not need access to your account for this.
      </Meta>
    </PublicCard>
  );
}
