import { ArrowRight } from "lucide-react";
import { cookies } from "next/headers";
import Link from "next/link";
import { Badge, Eyebrow } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Facts, Meta, Page, SectionTitle } from "@/components/ui/page";
import { getDb } from "@/db/client";
import { requireEnv } from "@/lib/env";
import { verifySignedValue } from "@/lib/signed";
import { isAdminEmail, requireSession } from "@/server/auth/current";
import { GHL_CLAIM_COOKIE, GHL_CLAIM_PAGE } from "@/server/ghl/config";
import { hasPendingInstall } from "@/server/ghl/install";
import { buildHeadline } from "@/lib/report";
import { listChannels, LIVE_STATUSES } from "@/server/channels";
import { readSnapshots } from "@/server/reports";
import { Notice } from "../ui";
import { ago, HeadlineCard } from "./reports/Headline";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  google_not_configured: "Channel connection is not configured yet.",
  account_suspended: "Your account is suspended. Renew your subscription to connect a channel.",
  channel_limit: "Your plan's channel limit is reached. Disconnect a channel first.",
  google_denied: "The Google permission was not granted.",
  scope_missing: "The comment permission was unticked on the Google screen. Connect again and keep it ticked.",
  no_refresh_token: "Google did not grant offline access. Connect again.",
  oauth_state: "The connection request expired. Try again.",
  oauth_failed: "Connecting failed. Try again.",
  channel_not_found: "That channel was not found.",
};

const REASONS: Record<string, string> = {
  no_channel: "This Google account has no channel. Connect the Google account that owns your channel.",
  connected_to_another_account: "This channel is already connected to another account.",
  account_suspended: "Your account is suspended.",
  access_revoked: "Access was revoked in your Google account. Connect again.",
};

export default async function AppPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { user, account, plan } = await requireSession();
  const params = await searchParams;
  const channelRows = await listChannels(getDb(), account.id);
  const live = channelRows.filter((c) => LIVE_STATUSES.includes(c.status)).length;
  const connecting = channelRows.some((c) => c.status === "connecting" || c.status === "disconnecting");
  const { reports, computedAt } = await readSnapshots(getDb(), account.id);
  // A HighLevel Marketplace install waiting for this browser's account (Phase 10).
  const claim = verifySignedValue<{ token: string }>((await cookies()).get(GHL_CLAIM_COOKIE)?.value, requireEnv("AUTH_SECRET"));
  const pendingInstall = claim ? await hasPendingInstall(getDb(), claim.token) : false;

  const canConnect = live < plan.channelLimit && account.status === "active";
  const hasHeadline = Boolean(reports.this_month && reports.all_time);

  return (
    <Page>
      {/* While the worker resolves a channel, refresh every few seconds. */}
      {connecting ? <meta httpEquiv="refresh" content="3" /> : null}

      {params.error && ERRORS[params.error] ? <Notice tone="error">{ERRORS[params.error]}</Notice> : null}
      {pendingInstall ? (
        <Notice tone="info">
          You installed the app from HighLevel. <a href={GHL_CLAIM_PAGE}>Finish connecting it to this account.</a>
        </Notice>
      ) : null}
      {params.connected ? <Notice tone="info">Google access granted. Finishing the connection.</Notice> : null}
      {params.disconnected ? <Notice tone="info">Channel disconnected. Its YouTube data is being deleted.</Notice> : null}
      {account.status === "suspended" ? (
        <Notice tone="error">Your account is suspended. Nothing is polled or sent. Your reports are kept.</Notice>
      ) : null}

      {reports.this_month && reports.all_time ? (
        <HeadlineCard headline={buildHeadline(reports.this_month, reports.all_time, plan)} updated={ago(computedAt)}>
          <div className="flex flex-wrap items-center gap-4 pt-1">
            {live > 0 ? (
              <Button asChild pulse>
                <Link href="/app/queue">
                  Open approval queue <ArrowRight className="size-4" aria-hidden />
                </Link>
              </Button>
            ) : null}
            <Link href="/app/reports" className="text-[15px] font-semibold">
              Full report per video, keyword and reply
            </Link>
          </div>
        </HeadlineCard>
      ) : null}

      {channelRows.length === 0 ? (
        <Card variant="hero" className="grid gap-4 p-6">
          <Eyebrow>Get started</Eyebrow>
          <h1 className="m-0 text-[30px] font-bold leading-tight tracking-[-0.018em]">No channel connected yet.</h1>
          <ol className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(100%,200px),1fr))] gap-3 p-0">
            {["Connect your channel", "Add a keyword", "Approve replies"].map((step, i) => (
              <li key={step} className={`grid gap-1 rounded-lg border bg-surface p-3.5 ${i === 0 ? "border-primary" : "border-border"}`}>
                <span className={`font-mono text-[13px] ${i === 0 ? "text-primary-700" : "text-muted-foreground"}`}>0{i + 1}</span>
                <strong className={`text-[15px] ${i === 0 ? "" : "text-label"}`}>{step}</strong>
              </li>
            ))}
          </ol>
          {canConnect ? (
            <div className="grid justify-items-start gap-2">
              <Button asChild pulse>
                <a href="/api/oauth/google/start">
                  Connect your channel <ArrowRight className="size-4" aria-hidden />
                </a>
              </Button>
            </div>
          ) : null}
        </Card>
      ) : null}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] gap-5">
        <Card className="grid content-start gap-3">
          <SectionTitle>Channel</SectionTitle>
          {channelRows.length === 0 ? <p className="m-0 text-[15px] text-muted-foreground">No channel connected yet.</p> : null}
          {channelRows.map((channel) => (
            <div key={channel.id} className="flex items-center justify-between gap-3 rounded-md bg-background p-3">
              <div className="grid min-w-0 gap-1">
                <strong className="text-base">{channel.title ?? (channel.status === "connecting" ? "Connecting..." : "Channel")}</strong>
                <span className={`inline-flex items-center gap-1.5 text-[13px] font-bold ${channel.status === "connected" ? "text-success" : "text-muted-foreground"}`}>
                  {channel.status === "connected" ? <span aria-hidden className="size-1.5 rounded-full bg-success" /> : null}
                  {channel.status}
                  {channel.statusReason && REASONS[channel.statusReason] ? `: ${REASONS[channel.statusReason]}` : ""}
                </span>
              </div>
              {channel.status !== "disconnecting" && channel.status !== "connecting" ? (
                <form method="post" action="/api/channels/disconnect">
                  <input type="hidden" name="channelId" value={channel.id} />
                  <Button type="submit" variant="outline" size="sm" className="flex-none">
                    {channel.status === "connected" ? "Disconnect" : "Remove"}
                  </Button>
                </form>
              ) : null}
            </div>
          ))}
          {channelRows.length > 0 && canConnect ? (
            <div>
              <Button asChild variant={hasHeadline || live > 0 ? "outline" : "primary"} size="sm">
                <a href="/api/oauth/google/start">Connect your channel</a>
              </Button>
            </div>
          ) : null}
          <Meta>We ask Google only for permission to read comments and post the replies you approve. Every reply waits for your approval.</Meta>
        </Card>

        <Card className="grid content-start gap-3">
          <div className="flex items-center justify-between gap-2">
            <SectionTitle>Account</SectionTitle>
            <Badge tone="primary" className="uppercase tracking-wide">
              {plan.label}
            </Badge>
          </div>
          <Facts
            items={[
              ["Email", user.email],
              ["Plan", `${plan.label}${plan.priceLabel ? ` (${plan.priceLabel})` : ""}${account.trialEndsAt ? `, trial ends ${account.trialEndsAt.toISOString().slice(0, 10)}` : ""}`],
              ["Replies", `${plan.monthlyReplyCap ?? "no plan limit"} per month, at most ${plan.dailyReplyCap ?? "unlimited"} per day`],
            ]}
          />
          <div className="flex flex-wrap gap-4 text-sm">
            {plan.billing === "monthly" || plan.billing === "annual" ? (
              <Link href="/app/cancel" className="text-muted-foreground">
                Cancel subscription
              </Link>
            ) : null}
            {isAdminEmail(user.email) ? <Link href="/admin">Owner admin</Link> : null}
          </div>
        </Card>
      </div>
    </Page>
  );
}
