import { getDb } from "@/db/client";
import { env } from "@/lib/env";
import { currentSession } from "@/server/auth/current";
import {
  addTemplate,
  createCampaign,
  deleteCampaign,
  deleteTemplate,
  type Result,
  setAiSettings,
  setCampaignActive,
  setDefaultLanguage,
} from "@/server/campaigns";
import { isSameOrigin, redirectTo } from "@/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ok: Result = { ok: true };
const notFound: Result = { ok: false, error: "Not found." };

// Form posts from /app/campaigns. Plain forms, no client JavaScript needed.
export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const session = await currentSession();
  if (!session) return redirectTo("/login");
  const form = await request.formData();
  const field = (name: string) => String(form.get(name) ?? "");
  const accountId = session.account.id;
  const db = getDb();

  let result: Result;
  switch (field("action")) {
    case "create":
      result = await createCampaign(db, accountId, {
        channelId: field("channelId"),
        name: field("name"),
        keyword: field("keyword"),
        aliases: field("aliases"),
        intent: field("intent"),
        destinationUrl: field("destinationUrl"),
        videos: field("videos"),
      });
      break;
    case "pause":
    case "resume":
      result = (await setCampaignActive(db, accountId, field("campaignId"), field("action") === "resume")) ? ok : notFound;
      break;
    case "delete":
      result = (await deleteCampaign(db, accountId, field("campaignId"))) ? ok : notFound;
      break;
    case "template_add":
      result = await addTemplate(db, accountId, { campaignId: field("campaignId"), language: field("language"), body: field("body") });
      break;
    case "template_delete":
      result = (await deleteTemplate(db, accountId, field("templateId"))) ? ok : notFound;
      break;
    case "language":
      result = (await setDefaultLanguage(db, accountId, field("channelId"), field("language"))) ? ok : notFound;
      break;
    case "ai":
      result = await setAiSettings(db, accountId, { provider: field("provider"), apiKey: field("apiKey"), model: field("model") }, env().ENCRYPTION_KEY);
      break;
    default:
      result = { ok: false, error: "Unknown action." };
  }
  return redirectTo(result.ok ? "/app/campaigns?saved=1" : `/app/campaigns?error=${encodeURIComponent(result.error)}`);
}
