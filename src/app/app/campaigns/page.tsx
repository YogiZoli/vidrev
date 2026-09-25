import { getDb } from "@/db/client";
import { LANGUAGE_OPTIONS } from "@/lib/language";
import { fallbackHost } from "@/lib/link-host";
import { DEFAULT_MODELS } from "@/server/ai";
import { requireSession } from "@/server/auth/current";
import { listCampaigns, parseVideoIds } from "@/server/campaigns";
import { ensureStaticLink } from "@/server/links";
import { listChannels } from "@/server/channels";
import { Notice, styles } from "../../ui";

export const dynamic = "force-dynamic";

const INTENT_LABEL = { hot: "HOT", warm: "WARM", cold: "COLD" } as const;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block", margin: "10px 0" }}>
      <span style={{ display: "block", fontSize: 14, marginBottom: 4 }}>{label}</span>
      {children}
    </label>
  );
}

function LanguageSelect({ name, value }: { name: string; value?: string }) {
  return (
    <select name={name} defaultValue={value ?? "en"} style={styles.input}>
      {LANGUAGE_OPTIONS.map((code) => (
        <option key={code} value={code}>
          {code}
        </option>
      ))}
    </select>
  );
}

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { account } = await requireSession();
  const params = await searchParams;
  const db = getDb();
  const channel = (await listChannels(db, account.id)).find((c) => c.status === "connected");
  const campaignRows = await listCampaigns(db, account.id);
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
    <main style={styles.main}>
      <p>
        <a href="/app">Back</a> · <a href="/app/queue">Approval queue</a>
      </p>
      <h1>Keywords and replies</h1>
      {params.error ? <Notice tone="error">{params.error}</Notice> : null}
      {params.saved ? <Notice tone="info">Saved.</Notice> : null}
      {!channel ? <Notice tone="error">Connect your channel first.</Notice> : null}

      {campaignRows.map((campaign) => (
        <section key={campaign.id} style={styles.card}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <strong>{campaign.name}</strong> <span style={styles.muted}>({campaign.active ? "on" : "paused"})</span>
              <br />
              Keyword: <code>{campaign.keyword}</code>
              {campaign.aliases.length ? ` (also: ${campaign.aliases.join(", ")})` : ""} · {INTENT_LABEL[campaign.intent]}
              <br />
              <span style={styles.muted}>
                {campaign.videoIds ? `${campaign.videoIds.length} video(s)` : "All videos"} · {campaign.destinationUrl}
              </span>
              {staticLinks.get(campaign.id) ? (
                <>
                  <br />
                  <span style={{ fontSize: 14 }}>
                    Link for descriptions and pinned comments: <code>{staticLinks.get(campaign.id)}</code>
                  </span>
                  {videoLink && params.campaign === campaign.id ? (
                    <>
                      <br />
                      <span style={{ fontSize: 14 }}>
                        Link for video {videoId}: <code>{videoLink.url}</code>
                      </span>
                    </>
                  ) : null}
                  <form method="get" action="/app/campaigns" style={{ display: "flex", gap: 6, marginTop: 6 }}>
                    <input type="hidden" name="campaign" value={campaign.id} />
                    <input name="video" placeholder="Video link for a per-video link" style={{ ...styles.input, width: 260 }} />
                    <button type="submit" style={styles.secondary}>
                      Get link
                    </button>
                  </form>
                </>
              ) : null}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <form method="post" action="/api/campaigns">
                <input type="hidden" name="campaignId" value={campaign.id} />
                <button name="action" value={campaign.active ? "pause" : "resume"} style={styles.secondary}>
                  {campaign.active ? "Pause" : "Resume"}
                </button>
              </form>
              <form method="post" action="/api/campaigns">
                <input type="hidden" name="campaignId" value={campaign.id} />
                <button name="action" value="delete" style={styles.secondary}>
                  Delete
                </button>
              </form>
            </div>
          </div>

          <h3 style={{ fontSize: 15 }}>Approved reply templates</h3>
          {campaign.templates.length === 0 ? (
            <p style={styles.muted}>No templates yet. AI drafts are written in your default language.</p>
          ) : null}
          {campaign.templates.map((template) => (
            <form key={template.id} method="post" action="/api/campaigns" style={{ display: "flex", gap: 8, alignItems: "center", padding: "4px 0" }}>
              <input type="hidden" name="templateId" value={template.id} />
              <code>{template.language}</code>
              <span style={{ flex: 1 }}>{template.body}</span>
              <button name="action" value="template_delete" style={styles.secondary}>
                Remove
              </button>
            </form>
          ))}
          <form method="post" action="/api/campaigns">
            <input type="hidden" name="campaignId" value={campaign.id} />
            <Field label="Language">
              <LanguageSelect name="language" value={channel?.defaultLanguage} />
            </Field>
            <Field label="Reply text (use {link} once where the link goes)">
              <textarea name="body" rows={2} required style={styles.input} defaultValue="Here you go: {link}" />
            </Field>
            <button name="action" value="template_add" style={styles.secondary}>
              Add template
            </button>
          </form>
        </section>
      ))}

      {channel ? (
        <section style={styles.card}>
          <h2 style={{ marginTop: 0 }}>New keyword</h2>
          <form method="post" action="/api/campaigns">
            <input type="hidden" name="channelId" value={channel.id} />
            <Field label="Keyword viewers comment (whole word, any case)">
              <input name="keyword" required maxLength={50} style={styles.input} placeholder="GUIDE" />
            </Field>
            <Field label="Other spellings (comma separated, optional)">
              <input name="aliases" style={styles.input} placeholder="guides, pdf" />
            </Field>
            <Field label="Name (what the viewer gets)">
              <input name="name" style={styles.input} placeholder="Free guide" />
            </Field>
            <Field label="Intent">
              <select name="intent" defaultValue="warm" style={styles.input}>
                <option value="hot">HOT (ready to buy)</option>
                <option value="warm">WARM</option>
                <option value="cold">COLD</option>
              </select>
            </Field>
            <Field label="Your opt-in page">
              <input name="destinationUrl" type="url" required style={styles.input} placeholder="https://yourdomain.com/guide" />
            </Field>
            <Field label="Only these videos (links, optional; empty means all videos)">
              <textarea name="videos" rows={2} style={styles.input} />
            </Field>
            <button name="action" value="create" style={styles.button}>
              Start watching
            </button>
          </form>
          <p style={styles.muted}>Only comments posted after you start watching get a draft. Nothing is posted until you approve it.</p>
        </section>
      ) : null}

      {channel ? (
        <section style={styles.card}>
          <h2 style={{ marginTop: 0 }}>Default reply language</h2>
          <form method="post" action="/api/campaigns" style={{ display: "flex", gap: 8 }}>
            <input type="hidden" name="channelId" value={channel.id} />
            <LanguageSelect name="language" value={channel?.defaultLanguage} />
            <button name="action" value="language" style={styles.secondary}>
              Save
            </button>
          </form>
          <p style={styles.muted}>
            A reply uses the commenter&apos;s language only when you have a template in it; otherwise this language, then English.
          </p>
        </section>
      ) : null}

      <section style={styles.card}>
        <h2 style={{ marginTop: 0 }}>AI drafts</h2>
        <p style={styles.muted}>
          Current: {account.aiProvider === "platform" ? "included AI (no setup needed)" : `your own ${account.aiProvider} key`}. The
          commenter&apos;s name is never sent to the AI.
        </p>
        <form method="post" action="/api/campaigns">
          <Field label="Provider">
            <select name="provider" defaultValue={account.aiProvider} style={styles.input}>
              <option value="platform">Included AI</option>
              <option value="gemini">My own Gemini key (billing enabled)</option>
              <option value="openai">My own OpenAI key</option>
              <option value="anthropic">My own Anthropic key</option>
            </select>
          </Field>
          <Field label="API key (stored encrypted, leave empty to keep the saved one)">
            <input name="apiKey" type="password" autoComplete="off" style={styles.input} />
          </Field>
          <Field label={`Model (optional, e.g. ${Object.values(DEFAULT_MODELS).join(", ")})`}>
            <input name="model" defaultValue={account.aiModel ?? ""} style={styles.input} />
          </Field>
          <button name="action" value="ai" style={styles.secondary}>
            Save AI settings
          </button>
        </form>
      </section>
    </main>
  );
}
