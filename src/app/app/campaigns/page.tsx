import { CopyMono } from "@/components/motion/CopyButton";
import { Badge, IntentTag, Keyword } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Meta, Page, PageHeader, SectionTitle } from "@/components/ui/page";
import { getDb } from "@/db/client";
import { LANGUAGE_OPTIONS } from "@/lib/language";
import { fallbackHost } from "@/lib/link-host";
import { requireSession } from "@/server/auth/current";
import { listCampaigns, parseVideoIds } from "@/server/campaigns";
import { ensureStaticLink } from "@/server/links";
import { listChannels } from "@/server/channels";
import { pickableVideos } from "@/server/video-picker";
import { Notice } from "../../ui";

export const dynamic = "force-dynamic";

const INTENT_LABEL = { hot: "HOT", warm: "WARM", cold: "COLD" } as const;

function StepNo({ n }: { n: number }) {
  return (
    <span aria-hidden className="grid size-7 place-items-center rounded-full bg-primary font-mono text-[13px] font-bold text-primary-foreground">
      {n}
    </span>
  );
}

function LanguageSelect({ name, value }: { name: string; value?: string }) {
  return (
    <Select name={name} defaultValue={value ?? "en"}>
      {LANGUAGE_OPTIONS.map((code) => (
        <option key={code} value={code}>
          {code}
        </option>
      ))}
    </Select>
  );
}

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { account } = await requireSession();
  const params = await searchParams;
  const db = getDb();
  const channel = (await listChannels(db, account.id)).find((c) => c.status === "connected");
  const campaignRows = await listCampaigns(db, account.id);
  const pickable = channel ? await pickableVideos(db, channel) : [];
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

  return (
    <Page width="md">
      <PageHeader title="Campaigns" lead="Pick the video, the keyword and where the link points. A viewer comments the keyword, you approve the reply, the link carries the tracking id." />
      {params.error ? <Notice tone="error">{params.error}</Notice> : null}
      {params.saved ? <Notice tone="info">Saved.</Notice> : null}
      {!channel ? <Notice tone="error">Connect your channel first.</Notice> : null}

      {channel ? (
        <Card variant="hero" className="grid gap-5">
          <SectionTitle>New campaign</SectionTitle>
          <form method="post" action="/api/campaigns" className="grid gap-6">
            <input type="hidden" name="channelId" value={channel.id} />

            <fieldset className="m-0 grid gap-3 border-0 p-0">
              <legend className="mb-2 flex items-center gap-2 p-0 text-base font-bold">
                <StepNo n={1} /> Video
              </legend>
              {pickable.length ? (
                <div className="grid max-h-80 gap-1 overflow-y-auto rounded-md border border-border bg-surface p-2">
                  {pickable.map((video) => (
                    <label key={video.youtubeVideoId} className="flex cursor-pointer items-start gap-2.5 rounded-md p-2 hover:bg-background">
                      <input type="checkbox" name="videoIds" value={video.youtubeVideoId} className="mt-1 size-4 flex-none accent-[var(--primary-600)]" />
                      <span className="grid min-w-0 gap-0.5">
                        <span className="text-[15px] [overflow-wrap:anywhere]">{video.title ?? video.youtubeVideoId}</span>
                        {video.publishedAt ? <Meta>{video.publishedAt.toISOString().slice(0, 10)}</Meta> : null}
                      </span>
                    </label>
                  ))}
                </div>
              ) : (
                <Meta className="text-[15px]">We could not list your latest videos right now. Paste a video link below.</Meta>
              )}
              <Field label="Or paste video links (optional)">
                <Textarea name="videos" rows={2} placeholder="https://youtu.be/..." />
              </Field>
              <Meta>Pick at least one video. Only comments on these videos get a reply draft.</Meta>
            </fieldset>

            <fieldset className="m-0 grid gap-3 border-0 p-0">
              <legend className="mb-2 flex items-center gap-2 p-0 text-base font-bold">
                <StepNo n={2} /> Keyword
              </legend>
              <Field label="Keyword viewers comment (whole word, any case)">
                <Input name="keyword" required maxLength={50} defaultValue="GUIDE" className="font-mono" />
              </Field>
              <Field label="Lead temperature">
                <Select name="intent" defaultValue="warm">
                  <option value="hot">Hot (ready to buy)</option>
                  <option value="warm">Warm</option>
                  <option value="cold">Cold</option>
                </Select>
              </Field>
            </fieldset>

            <fieldset className="m-0 grid gap-3 border-0 p-0">
              <legend className="mb-2 flex items-center gap-2 p-0 text-base font-bold">
                <StepNo n={3} /> Target URL
              </legend>
              <Field label="Where the reply link points" hint="Your default from setup. Change it for this campaign if needed.">
                <Input name="destinationUrl" type="url" required defaultValue={account.defaultTargetUrl ?? ""} placeholder="https://yourdomain.com/guide" className="font-mono" />
              </Field>
            </fieldset>

            <div className="grid justify-items-start gap-2">
              <Button name="action" value="create" pulse>
                Start watching
              </Button>
              <Meta>Only comments posted after you start get a draft. Each draft waits for your approval.</Meta>
            </div>
          </form>
        </Card>
      ) : null}

      {campaignRows.length ? <SectionTitle>Live rules</SectionTitle> : null}

      {campaignRows.map((campaign) => (
        <Card key={campaign.id} className="grid gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="grid min-w-0 gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <strong className="text-lg">{campaign.name}</strong>
                <Badge tone={campaign.active ? "success" : "neutral"}>{campaign.active ? "on" : "paused"}</Badge>
                <IntentTag>{INTENT_LABEL[campaign.intent]}</IntentTag>
              </div>
              <p className="m-0 text-[15px]">
                Keyword: <Keyword>{campaign.keyword}</Keyword>
                {campaign.aliases.length ? ` (also: ${campaign.aliases.join(", ")})` : ""}
              </p>
              <Meta className="[overflow-wrap:anywhere]">
                {campaign.videoIds ? `${campaign.videoIds.length} video(s)` : "All videos"} · {campaign.destinationUrl}
              </Meta>
              {staticLinks.get(campaign.id) ? (
                <>
                  <p className="m-0 text-sm">
                    Link for descriptions and pinned comments: <CopyMono text={staticLinks.get(campaign.id) ?? ""} className="mt-1" />
                  </p>
                  {videoLink && params.campaign === campaign.id ? (
                    <p className="m-0 text-sm">
                      Link for video {videoId}: <CopyMono text={videoLink.url} className="mt-1" />
                    </p>
                  ) : null}
                  <form method="get" action="/app/campaigns" className="mt-1.5 flex flex-wrap gap-2">
                    <input type="hidden" name="campaign" value={campaign.id} />
                    <Input name="video" placeholder="Video link for a per-video link" aria-label="Video link" className="w-full sm:w-[280px]" />
                    <Button type="submit" variant="outline">
                      Get link
                    </Button>
                  </form>
                </>
              ) : null}
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

          <div className="grid gap-2 border-t border-border pt-4">
            <SectionTitle className="text-[15px]">Approved reply templates</SectionTitle>
            {campaign.templates.length === 0 ? <Meta className="text-[15px]">No templates yet. AI drafts are written in your default language.</Meta> : null}
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
            <form method="post" action="/api/campaigns" className="grid gap-3">
              <input type="hidden" name="campaignId" value={campaign.id} />
              <Field label="Language">
                <LanguageSelect name="language" value={channel?.defaultLanguage} />
              </Field>
              <Field label="Reply text (use {link} once where the link goes)">
                <Textarea name="body" rows={2} required defaultValue="Here you go: {link}" />
              </Field>
              <div>
                <Button name="action" value="template_add" variant="outline">
                  Add template
                </Button>
              </div>
            </form>
          </div>
        </Card>
      ))}



    </Page>
  );
}
