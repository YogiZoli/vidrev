import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { Meta, Page, PageHeader, SectionTitle } from "@/components/ui/page";
import { getDb } from "@/db/client";
import { LANGUAGE_OPTIONS } from "@/lib/language";
import { DEFAULT_MODELS } from "@/server/ai";
import { requireSession } from "@/server/auth/current";
import { listChannels } from "@/server/channels";
import { Notice } from "../../../ui";

export const dynamic = "force-dynamic";

// Settings > Replies: reply language and the AI that writes the drafts.
export default async function RepliesSettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { account } = await requireSession();
  const params = await searchParams;
  const channel = (await listChannels(getDb(), account.id)).find((c) => c.status === "connected");

  return (
    <Page width="md">
      <PageHeader title="Replies" lead="The language and the AI behind every draft. Nothing is posted until you approve it." />
      {params.error ? <Notice tone="error">{params.error}</Notice> : null}
      {params.saved ? <Notice tone="info">Saved.</Notice> : null}

      {channel ? (
        <Card className="grid gap-3">
          <SectionTitle>Default reply language</SectionTitle>
          <form method="post" action="/api/campaigns" className="flex flex-wrap gap-2">
            <input type="hidden" name="back" value="/app/settings/replies" />
            <input type="hidden" name="channelId" value={channel.id} />
            <div className="w-40">
              <Select name="language" defaultValue={channel.defaultLanguage ?? "en"} aria-label="Default reply language">
                {LANGUAGE_OPTIONS.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </Select>
            </div>
            <Button name="action" value="language" variant="outline">
              Save
            </Button>
          </form>
          <Meta>A reply uses the commenter&apos;s language only when you have a template in it; otherwise this language, then English.</Meta>
        </Card>
      ) : null}

      <Card className="grid gap-3">
        <SectionTitle>AI drafts</SectionTitle>
        <Meta className="text-[15px]">
          Current: {account.aiProvider === "platform" ? "included AI (no setup needed)" : `your own ${account.aiProvider} key`}. The
          commenter&apos;s name is never sent to the AI.
        </Meta>
        <form method="post" action="/api/campaigns" className="grid gap-3">
          <input type="hidden" name="back" value="/app/settings/replies" />
          <Field label="Provider">
            <Select name="provider" defaultValue={account.aiProvider}>
              <option value="platform">Included AI</option>
              <option value="gemini">My own Gemini key (billing enabled)</option>
              <option value="openai">My own OpenAI key</option>
              <option value="anthropic">My own Anthropic key</option>
            </Select>
          </Field>
          <Field label="API key (stored encrypted, leave empty to keep the saved one)">
            <Input name="apiKey" type="password" autoComplete="off" />
          </Field>
          <Field label={`Model (optional, e.g. ${Object.values(DEFAULT_MODELS).join(", ")})`}>
            <Input name="model" defaultValue={account.aiModel ?? ""} />
          </Field>
          <div>
            <Button name="action" value="ai" variant="outline">
              Save AI settings
            </Button>
          </div>
        </form>
      </Card>
    </Page>
  );
}
