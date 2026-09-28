import { ArrowRight, Check } from "lucide-react";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { Eyebrow } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Meta, Page } from "@/components/ui/page";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { integrations } from "@/db/schema";
import { env, requireEnv } from "@/lib/env";
import { cn } from "@/lib/cn";
import { requireSession } from "@/server/auth/current";
import { ghlConfigured } from "@/server/ghl/config";
import { readGhlConfig } from "@/server/ghl/tokens";
import { completeOnboardingIfReady, type OnboardingStep, onboardingState, parseTargetUrl } from "@/server/onboarding";
import { Notice } from "../ui";

export const dynamic = "force-dynamic";

// Google callback errors (same keys as before the gate).
const ERRORS: Record<string, string> = {
  google_not_configured: "Channel connection is not configured yet.",
  account_suspended: "Your account is suspended.",
  channel_limit: "Your plan's channel limit is reached.",
  google_denied: "The Google permission was not granted.",
  scope_missing: "The comment permission was unticked on the Google screen. Connect again and keep it ticked.",
  no_refresh_token: "Google did not grant offline access. Connect again.",
  oauth_state: "The connection request expired. Try again.",
  oauth_failed: "Connecting failed. Try again.",
};

const STEPS: { key: OnboardingStep; title: string; why: string }[] = [
  { key: "youtube", title: "Connect your YouTube channel", why: "We read the comments on your videos and post the replies you approve." },
  { key: "crm", title: "Connect the CRM where your leads land", why: "Every viewer who opts in through a reply link lands in your CRM, tagged with the video and keyword." },
  { key: "purchases", title: "Choose what counts as a purchase", why: "So each video and keyword shows the revenue it brought in." },
  { key: "target", title: "Set your default target URL", why: "Your opt-in page: where the link in each reply points." },
];

function Step({ n, title, why, state, children }: { n: number; title: string; why: string; state: "done" | "current" | "later"; children?: ReactNode }) {
  return (
    <li className={cn("grid gap-3 rounded-lg border bg-surface p-4", state === "current" ? "border-primary" : "border-border")}>
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={cn(
            "grid size-7 flex-none place-items-center rounded-full font-mono text-[13px] font-bold",
            state === "done" ? "bg-success text-white" : state === "current" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground",
          )}
        >
          {state === "done" ? <Check className="size-4" /> : n}
        </span>
        <div className="grid gap-0.5">
          <strong className={cn("text-base", state === "later" && "text-muted-foreground")}>{title}</strong>
          {state !== "later" ? <Meta className="text-[15px]">{why}</Meta> : null}
        </div>
        <span className="sr-only">{state === "done" ? "done" : state === "current" ? "current step" : "later"}</span>
      </div>
      {state === "current" ? <div className="grid gap-3 pl-10">{children}</div> : null}
    </li>
  );
}

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { account } = await requireSession();
  if (account.onboardedAt) redirect("/app");
  const db = getDb();
  // Every step may already be done (for example a Stripe key that just turned active).
  if (await completeOnboardingIfReady(db, account.id)) redirect("/app?welcome=1");
  const params = await searchParams;
  const state = await onboardingState(db, account.id);
  // Target URL prefill: the saved one, else the website of the GoHighLevel Sub-account.
  let suggested: string | null = null;
  if (!state.defaultTargetUrl && state.current === "target") {
    const [ghl] = await db
      .select({ configEnc: integrations.configEnc })
      .from(integrations)
      .where(and(eq(integrations.accountId, account.id), eq(integrations.type, "ghl"), eq(integrations.status, "active")));
    const website = ghl?.configEnc ? readGhlConfig(ghl.configEnc, requireEnv("ENCRYPTION_KEY")).locationWebsite : null;
    suggested = website ? parseTargetUrl(website) : null;
  }
  const stateOf = (key: OnboardingStep) => (state.done[key] ? "done" : state.current === key ? "current" : "later");

  return (
    <Page width="sm">
      {/* While the worker resolves the channel, refresh every few seconds. */}
      {state.channelConnecting ? <meta httpEquiv="refresh" content="3" /> : null}
      <div className="grid gap-2">
        <Eyebrow>Set up</Eyebrow>
        <h1 className="m-0 text-[28px] font-bold leading-tight tracking-[-0.016em]">Four steps, then your comments start working.</h1>
        <p className="m-0 text-base text-label">
          Nothing is read, drafted or sent until every step is done: a comment only pays off when it can turn into a lead and a sale.
        </p>
      </div>
      {params.error ? <Notice tone="error">{ERRORS[params.error] ?? params.error}</Notice> : null}
      {params.connected || state.channelConnecting ? <Notice tone="info">Google access granted. Finishing the connection.</Notice> : null}
      {params.ghl_connected ? <Notice tone="info">GoHighLevel connected.</Notice> : null}

      <ol className="m-0 grid list-none gap-3 p-0">
        <Step n={1} {...STEPS[0]} state={stateOf("youtube")}>
          {state.channelConnecting ? null : (
            <div>
              <Button asChild pulse>
                <a href="/api/oauth/google/start">
                  Connect YouTube <ArrowRight className="size-4" aria-hidden />
                </a>
              </Button>
            </div>
          )}
          <Meta>We ask Google only for permission to read comments and post the replies you approve.</Meta>
        </Step>

        <Step n={2} {...STEPS[1]} state={stateOf("crm")}>
          {ghlConfigured() ? (
            <div>
              <Button asChild pulse>
                <a href="/api/oauth/crm/start">
                  Connect GoHighLevel <ArrowRight className="size-4" aria-hidden />
                </a>
              </Button>
            </div>
          ) : (
            <Meta className="text-[15px]">Connecting GoHighLevel is not available yet.</Meta>
          )}
          <Meta>One click: pick your Sub-account and approve.</Meta>
          {env().GHL_AFFILIATE_URL ? (
            <Meta className="text-[15px]">
              No GoHighLevel yet?{" "}
              <a href={env().GHL_AFFILIATE_URL} target="_blank" rel="noopener sponsored">
                Start a GoHighLevel free trial
              </a>{" "}
              (affiliate link: we may earn a commission), then come back here.
            </Meta>
          ) : null}
        </Step>

        <Step n={3} {...STEPS[2]} state={stateOf("purchases")}>
          <form method="post" action="/api/onboarding">
            <input type="hidden" name="action" value="purchase_ghl" />
            <Button type="submit" pulse>
              GoHighLevel payments and won opportunities
            </Button>
          </form>
          <details className="rounded-md bg-background p-3 text-[15px]">
            <summary className="cursor-pointer font-semibold">I sell through Stripe</summary>
            <ol className="mb-3 mt-2 grid gap-1 pl-5 text-sm">
              <li>In Stripe, open Developers, then API keys, then Create restricted key.</li>
              <li>Give it Read access to Charges, Customers and Invoices, and no access to anything else.</li>
              <li>Copy the key that starts with rk_live_ and paste it below.</li>
            </ol>
            <form method="post" action="/api/onboarding" className="grid gap-3">
              <input type="hidden" name="action" value="purchase_stripe" />
              <Field label="Restricted key">
                <Input name="apiKey" type="password" autoComplete="off" placeholder="rk_live_..." className="font-mono" required />
              </Field>
              <div>
                <Button type="submit" variant="outline">
                  Connect Stripe
                </Button>
              </div>
            </form>
          </details>
        </Step>

        <Step n={4} {...STEPS[3]} state={stateOf("target")}>
          <form method="post" action="/api/onboarding" className="grid gap-3">
            <input type="hidden" name="action" value="target" />
            <Field
              label="Opt-in page URL"
              hint={
                suggested
                  ? "Filled in from your GoHighLevel Sub-account website. Change it to the exact page where viewers opt in. Links run on go.vidrev.app; your own link domain is optional, later in Settings."
                  : "Links run on go.vidrev.app. Your own link domain is optional, later in Settings."
              }
            >
              <Input name="url" type="url" required placeholder="https://yoursite.com/guide" defaultValue={state.defaultTargetUrl ?? suggested ?? ""} className="font-mono" />
            </Field>
            <div>
              <Button type="submit" pulse>
                Finish setup <ArrowRight className="size-4" aria-hidden />
              </Button>
            </div>
          </form>
        </Step>
      </ol>
    </Page>
  );
}
