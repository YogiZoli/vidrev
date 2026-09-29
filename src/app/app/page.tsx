import { ArrowRight } from "lucide-react";
import { cookies } from "next/headers";
import Link from "next/link";
import { Eyebrow } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Page } from "@/components/ui/page";
import { getDb } from "@/db/client";
import { requireEnv } from "@/lib/env";
import { verifySignedValue } from "@/lib/signed";
import { requireSession } from "@/server/auth/current";
import { GHL_CLAIM_COOKIE, GHL_CLAIM_PAGE } from "@/server/ghl/config";
import { hasPendingInstall } from "@/server/ghl/install";
import { buildHeadline } from "@/lib/report";
import { listChannels, LIVE_STATUSES } from "@/server/channels";
import { readSnapshots } from "@/server/reports";
import { Notice } from "../ui";
import { ApprovalQueue } from "./_home/Queue";
import { ago, HeadlineCard } from "./reports/Headline";
import { CHANNEL_CONNECT_ERRORS } from "@/lib/status-text";

export const dynamic = "force-dynamic";


export default async function AppPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { account, plan } = await requireSession();
  const params = await searchParams;
  const channelRows = await listChannels(getDb(), account.id);
  const live = channelRows.filter((c) => LIVE_STATUSES.includes(c.status)).length;
  const connecting = channelRows.some((c) => c.status === "connecting" || c.status === "disconnecting");
  const { reports, computedAt } = await readSnapshots(getDb(), account.id);
  // A HighLevel Marketplace install waiting for this browser's account (Phase 10).
  const claim = verifySignedValue<{ token: string }>((await cookies()).get(GHL_CLAIM_COOKIE)?.value, requireEnv("AUTH_SECRET"));
  const pendingInstall = claim ? await hasPendingInstall(getDb(), claim.token) : false;

  const canConnect = live < plan.channelLimit && account.status === "active";

  return (
    <Page>
      {/* While the worker resolves a channel, refresh every few seconds. */}
      {connecting ? <meta httpEquiv="refresh" content="3" /> : null}

      {params.error && CHANNEL_CONNECT_ERRORS[params.error] ? <Notice tone="error">{CHANNEL_CONNECT_ERRORS[params.error]}</Notice> : null}
      {pendingInstall ? (
        <Notice tone="info">
          You installed the app from HighLevel. <a href={GHL_CLAIM_PAGE}>Finish connecting it to this account.</a>
        </Notice>
      ) : null}
      {params.welcome ? (
        <Notice tone="info">
          Setup done. Next: <Link href="/app/campaigns">create your first automation</Link> (videos, trigger keyword, where they go).
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
            {["Connect your channel", "Create an automation", "Approve replies"].map((step, i) => (
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

      {live > 0 ? <ApprovalQueue /> : null}
    </Page>
  );
}
