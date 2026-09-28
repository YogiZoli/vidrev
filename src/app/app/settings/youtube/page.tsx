import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Meta, Page, PageHeader, SectionTitle } from "@/components/ui/page";
import { getDb } from "@/db/client";
import { requireSession } from "@/server/auth/current";
import { listChannels, LIVE_STATUSES } from "@/server/channels";
import { Notice } from "../../../ui";
import { CHANNEL_CONNECT_ERRORS, CHANNEL_REASONS } from "@/lib/status-text";

export const dynamic = "force-dynamic";



// Settings > YouTube channel: the channel that is polled and replied from.
export default async function YoutubeSettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { account, plan } = await requireSession();
  const params = await searchParams;
  const channelRows = await listChannels(getDb(), account.id);
  const live = channelRows.filter((c) => LIVE_STATUSES.includes(c.status)).length;
  const connecting = channelRows.some((c) => c.status === "connecting" || c.status === "disconnecting");
  const canConnect = live < plan.channelLimit && account.status === "active";

  return (
    <Page width="md">
      {connecting ? <meta httpEquiv="refresh" content="3" /> : null}
      <PageHeader title="YouTube channel" />
      {params.error && CHANNEL_CONNECT_ERRORS[params.error] ? <Notice tone="error">{CHANNEL_CONNECT_ERRORS[params.error]}</Notice> : null}
      {params.connected ? <Notice tone="info">Google access granted. Finishing the connection.</Notice> : null}
      {params.disconnected ? <Notice tone="info">Channel disconnected. Its YouTube data is being deleted.</Notice> : null}
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
                  {channel.statusReason && CHANNEL_REASONS[channel.statusReason] ? `: ${CHANNEL_REASONS[channel.statusReason]}` : ""}
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
          {canConnect ? (
            <div>
              <Button asChild variant={live > 0 ? "outline" : "primary"} size="sm">
                <a href="/api/oauth/google/start">Connect your channel</a>
              </Button>
            </div>
          ) : null}
          <Meta>We ask Google only for permission to read comments and post the replies you approve. Every reply waits for your approval.</Meta>
        </Card>

    </Page>
  );
}
