import { CopyMono } from "@/components/motion/CopyButton";
import { Badge, Keyword, TemperatureChip } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Meta, Page, PageHeader, SectionTitle } from "@/components/ui/page";
import { getDb } from "@/db/client";
import { LanguageSelect } from "@/components/forms/LanguageSelect";
import { fallbackHost } from "@/lib/link-host";
import { requireSession } from "@/server/auth/current";
import { listCampaigns, parseVideoIds } from "@/server/campaigns";
import { ensureStaticLink } from "@/server/links";
import { listChannels } from "@/server/channels";
import { webChannelDeps, webGhlDeps } from "@/server/channel-deps";
import { ghlDestinations } from "@/server/ghl/destinations";
import { pickableVideos } from "@/server/video-picker";
import { Notice } from "../../ui";
import { DestinationPicker } from "./DestinationPicker";
import { KeywordPicker } from "./KeywordPicker";
import { VideoPicker } from "./VideoPicker";

export const dynamic = "force-dynamic";


// Card tint per lead temperature (very light), matching the keyword rows.
const TINT = {
  cold: "border-cold-dot/40 bg-cold-surface/70",
  warm: "border-warm-dot/40 bg-warm-surface/70",
  hot: "border-hot-dot/40 bg-hot-surface/70",
} as const;

function StepNo({ n }: { n: number }) {
  return (
    <span aria-hidden className="grid size-7 place-items-center rounded-full bg-primary font-mono text-[13px] font-bold text-primary-foreground">
      {n}
    </span>
  );
}


export default async function AutomationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { account } = await requireSession();
  const params = await searchParams;
  const db = getDb();
  const channel = (await listChannels(db, account.id)).find((c) => c.status === "connected");
  const campaignRows = await listCampaigns(db, account.id);
  const destinations = await ghlDestinations(db, account.id, webGhlDeps());
  const videoList = channel ? await pickableVideos(db, channel.id, webChannelDeps()) : { source: "known" as const, videos: [] };
  // Reusable tracked links for video descriptions and pinned comments (R-07):
  // one channel-wide per keyword, and one per video on request.
  const host = fallbackHost();
  const staticLinks = new Map<string, string>();
  for (const campaign of campaignRows) {
    const link = await ensureStaticLink(db, { accountId: account.id, campaignId: campaign.id, youtubeVideoId: null, fallbackHost: host });
    if (link) staticLinks.set(campaign.id, link.url);
  }
  const videoId = params.video ? parseVideoIds(params.video)?.[0] : undefined;
  const videoLink =
    videoId && params.campaign
      ? await ensureStaticLink(db, { accountId: account.id, campaignId: params.campaign, youtubeVideoId: videoId, fallbackHost: host })
      : null;

  const liveCount = campaignRows.filter((c) => c.active).length;

  return (
    <Page width="lg">
      <PageHeader
        title="Automations"
        lead="Choose the videos, the trigger keyword and where viewers go. A viewer comments the keyword, you approve the reply, the link carries the tracking id."
      />
      {params.error ? <Notice tone="error">{params.error}</Notice> : null}
      {params.saved ? <Notice tone="info">Saved.</Notice> : null}
      {!channel ? <Notice tone="error">Connect your channel first.</Notice> : null}

      {channel ? (
        <Card variant="hero" className="grid gap-5">
          <SectionTitle>New automation</SectionTitle>
          <form method="post" action="/api/campaigns" className="grid gap-7">
            <input type="hidden" name="channelId" value={channel.id} />

            <fieldset className="m-0 grid gap-3 border-0 p-0">
              <legend className="mb-2 flex items-center gap-2 p-0 text-base font-bold">
                <StepNo n={1} /> Which videos?
              </legend>
              <VideoPicker
                hasStats={videoList.source === "youtube"}
                videos={videoList.videos.map((v) => ({
                  id: v.youtubeVideoId,
                  title: v.title,
                  publishedAt: v.publishedAt?.toISOString() ?? null,
                  thumbnail: v.thumbnail,
                  views: v.views,
                  comments: v.comments,
                }))}
              />
            </fieldset>

            <fieldset className="m-0 grid gap-3 border-0 p-0">
              <legend className="mb-2 flex items-center gap-2 p-0 text-base font-bold">
                <StepNo n={2} /> Which trigger keyword?
              </legend>
              <KeywordPicker />
            </fieldset>

            <fieldset className="m-0 grid gap-3 border-0 p-0">
              <legend className="mb-2 flex items-center gap-2 p-0 text-base font-bold">
                <StepNo n={3} /> Where do they go?
              </legend>
              <DestinationPicker
                items={destinations.items}
                baseUrl={destinations.baseUrl}
                domainVerified={destinations.domainVerified}
                status={destinations.status}
                defaultUrl={account.defaultTargetUrl ?? ""}
              />
            </fieldset>

            <div className="grid justify-items-start gap-2">
              <Button name="action" value="create" pulse>
                Go live
              </Button>
              <Meta>Only comments posted after you go live get a draft. Each draft waits for your approval.</Meta>
            </div>
          </form>
        </Card>
      ) : null}

      {campaignRows.length ? (
        <div className="flex items-center gap-2.5">
          <SectionTitle>Live automations</SectionTitle>
          {liveCount > 0 ? (
            <span className="relative inline-flex size-2.5" role="img" aria-label={`${liveCount} live`}>
              <span aria-hidden className="absolute inline-flex size-full animate-ping-slow rounded-full bg-success opacity-60" />
              <span aria-hidden className="relative inline-flex size-2.5 rounded-full bg-success" />
            </span>
          ) : null}
          <Meta className="text-[14px]">{liveCount} running</Meta>
        </div>
      ) : null}

      {campaignRows.map((campaign) => (
        <Card key={campaign.id} className={`grid gap-4 border ${TINT[campaign.intent]}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="grid min-w-0 gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Keyword className="text-[15px]">{campaign.keyword}</Keyword>
                <TemperatureChip temperature={campaign.intent} />
                <Badge tone={campaign.active ? "success" : "neutral"}>{campaign.active ? "live" : "paused"}</Badge>
              </div>
              <strong className="text-lg first-letter:uppercase">{campaign.name}</strong>
              <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[14px]">
                <dt className="text-muted-foreground">Videos</dt>
                <dd className="m-0">{campaign.videoIds ? `${campaign.videoIds.length} selected` : "All videos, including new uploads"}</dd>
                <dt className="text-muted-foreground">Send them to</dt>
                <dd className="m-0 [overflow-wrap:anywhere]">{campaign.destinationUrl}</dd>
              </dl>
            </div>
            <div className="flex gap-2">
              <form method="post" action="/api/campaigns">
                <input type="hidden" name="campaignId" value={campaign.id} />
                <Button name="action" value={campaign.active ? "pause" : "resume"} variant="outline" size="sm">
                  {campaign.active ? "Pause" : "Resume"}
                </Button>
              </form>
              <form method="post" action="/api/campaigns">
                <input type="hidden" name="campaignId" value={campaign.id} />
                <Button name="action" value="delete" variant="outline" size="sm">
                  Delete
                </Button>
              </form>
            </div>
          </div>

          {staticLinks.get(campaign.id) ? (
            <details className="rounded-md bg-surface/80 p-3 text-[15px]">
              <summary className="cursor-pointer font-semibold">Links for your description and pinned comment</summary>
              <div className="mt-2 grid gap-2 text-sm">
                <p className="m-0">
                  For every video: <CopyMono text={staticLinks.get(campaign.id) ?? ""} className="mt-1" />
                </p>
                {videoLink && params.campaign === campaign.id ? (
                  <p className="m-0">
                    For video {videoId}: <CopyMono text={videoLink.url} className="mt-1" />
                  </p>
                ) : null}
                <form method="get" action="/app/campaigns" className="flex flex-wrap gap-2">
                  <input type="hidden" name="campaign" value={campaign.id} />
                  <Input name="video" placeholder="Video link for a per-video link" aria-label="Video link" className="w-full sm:w-[280px]" />
                  <Button type="submit" variant="outline">
                    Get link
                  </Button>
                </form>
              </div>
            </details>
          ) : null}

          <details className="rounded-md bg-surface/80 p-3 text-[15px]">
            <summary className="cursor-pointer font-semibold">
              Advanced: your reply wording and brand style (optional){campaign.templates.length ? ` (${campaign.templates.length})` : ""}
            </summary>
            <div className="mt-2 grid gap-3">
              <Meta className="text-[14px]">
                The AI writes a fresh reply to every comment. Add a few replies in your own words here: the AI copies their tone and style, and if
                the AI is ever unavailable, one of these goes out instead. Put {"{link}"} where the link belongs. Each reply is in one language;
                comments in that language get it.
              </Meta>
              {campaign.templates.map((template) => (
                <form key={template.id} method="post" action="/api/campaigns" className="flex items-center gap-3 rounded-md bg-background p-2.5">
                  <input type="hidden" name="templateId" value={template.id} />
                  <Keyword>{template.language}</Keyword>
                  <span className="min-w-0 flex-1 text-[15px] [overflow-wrap:anywhere]">{template.body}</span>
                  <Button name="action" value="template_delete" variant="outline" size="sm" className="flex-none">
                    Remove
                  </Button>
                </form>
              ))}
              <form method="post" action="/api/campaigns" className="grid gap-3 sm:grid-cols-[140px_minmax(0,1fr)] sm:items-end">
                <input type="hidden" name="campaignId" value={campaign.id} />
                <Field label="Language">
                  <LanguageSelect name="language" value={channel?.defaultLanguage} />
                </Field>
                <Field label="Your reply">
                  <Textarea name="body" rows={2} required defaultValue="Here you go: {link}" />
                </Field>
                <div className="sm:col-start-2">
                  <Button name="action" value="template_add" variant="outline">
                    Save this reply
                  </Button>
                </div>
              </form>
            </div>
          </details>
        </Card>
      ))}
    </Page>
  );
}
