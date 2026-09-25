import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/db/client";
import { campaigns, channels, comments, replies, templates } from "@/db/schema";
import { runMigrations } from "@/scripts/migrate";
import { createAccountWithUser } from "@/server/accounts";
import { createDraft, type DraftDeps } from "./drafts";

const hasDb = Boolean(process.env.DATABASE_URL);
const now = new Date("2026-09-25T12:00:00Z");

function deps(ai: { apiKey?: string; answer?: string; fail?: boolean } = {}) {
  const sent: { queue: string; data: unknown }[] = [];
  const prompts: string[] = [];
  const d: DraftDeps = {
    db: getDb(),
    fetch: async (_url, init) => {
      prompts.push(String(init?.body ?? ""));
      if (ai.fail) return new Response("", { status: 500 });
      return Response.json({ candidates: [{ content: { parts: [{ text: ai.answer ?? "Enjoy it! {link}" }] } }] });
    },
    encryptionKey: undefined,
    platformAi: { apiKey: ai.apiKey, model: "gemini-test" },
    appBaseUrl: "https://app.example.com",
    productName: "Test",
    enqueue: async (queue, data) => {
      sent.push({ queue, data });
    },
    now: () => now,
  };
  return { d, sent, prompts };
}

async function setup(text: string, opts: { defaultLanguage?: string } = {}) {
  const db = getDb();
  const { account } = await createAccountWithUser(db, { email: `draft-${randomUUID()}@example.com`, planCode: "standard_monthly" });
  const [channel] = await db
    .insert(channels)
    .values({ accountId: account.id, youtubeChannelId: `UC${randomUUID()}`, status: "connected", defaultLanguage: opts.defaultLanguage ?? "en" })
    .returning();
  const created = new Date(now.getTime() - 86_400_000);
  const [warm] = await db
    .insert(campaigns)
    .values({ accountId: account.id, channelId: channel!.id, name: "Guide", keyword: "guide", destinationUrl: "https://e.com", createdAt: created })
    .returning();
  const [hot] = await db
    .insert(campaigns)
    .values({ accountId: account.id, channelId: channel!.id, name: "Call", keyword: "call", intent: "hot", destinationUrl: "https://e.com/c", createdAt: created })
    .returning();
  const [comment] = await db
    .insert(comments)
    .values({
      channelId: channel!.id,
      youtubeCommentId: `c-${randomUUID()}`,
      youtubeVideoId: "VID1",
      authorName: "Secret Name",
      text,
      publishedAt: new Date(now.getTime() - 60_000),
    })
    .returning();
  return { account, channel: channel!, warm: warm!, hot: hot!, comment: comment! };
}

async function replyFor(commentId: string) {
  const [row] = await getDb().select().from(replies).where(eq(replies.commentId, commentId));
  return row;
}

describe.skipIf(!hasDb)("drafts (integration)", () => {
  beforeAll(async () => {
    await runMigrations(process.env.DATABASE_URL!);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("drafts with the platform AI for the highest intent match and emails once", async () => {
    const { comment, hot } = await setup("guide or a call please");
    const { d, sent, prompts } = deps({ apiKey: "platform-key" });
    await createDraft(d, comment.id);
    const reply = await replyFor(comment.id);
    expect(reply).toMatchObject({ campaignId: hot.id, keyword: "call", intent: "hot", draftSource: "ai", body: "Enjoy it! {link}", status: "pending_approval" });
    expect(reply!.otherMatches).toMatchObject([{ keyword: "guide" }]);
    expect(prompts.join()).not.toContain("Secret Name");
    expect(sent.filter((s) => s.queue === "email.send")).toHaveLength(1);

    // Idempotent: a retried job creates no second draft.
    await createDraft(d, comment.id);
    expect(await getDb().select().from(replies).where(eq(replies.commentId, comment.id))).toHaveLength(1);
  });

  it("uses the approved template in the commenter's language when the AI fails", async () => {
    const { comment, warm, account } = await setup("Hola, me gustaría recibir la guide por favor");
    await getDb()
      .insert(templates)
      .values([
        { accountId: account.id, campaignId: warm.id, language: "en", body: "Here: {link}" },
        { accountId: account.id, campaignId: warm.id, language: "es", body: "Aquí está: {link}" },
      ]);
    const { d } = deps({ apiKey: "k", fail: true });
    await createDraft(d, comment.id);
    expect(await replyFor(comment.id)).toMatchObject({ language: "es", draftSource: "template", body: "Aquí está: {link}" });
  });

  it("marks the draft skipped when the monthly cap is used up", async () => {
    const { comment, account, channel, warm } = await setup("guide");
    await getDb()
      .insert(replies)
      .values(
        Array.from({ length: 300 }, () => ({
          accountId: account.id,
          channelId: channel.id,
          campaignId: warm.id,
          youtubeVideoId: "VID0",
          keyword: "guide",
          intent: "warm" as const,
          language: "en",
          body: "x {link}",
          draftSource: "template" as const,
          status: "sent" as const,
          approvedAt: new Date(now.getTime() - 3_600_000),
        })),
      );
    const { d, sent } = deps();
    await createDraft(d, comment.id);
    expect(await replyFor(comment.id)).toMatchObject({ status: "skipped", statusReason: "monthly_cap" });
    expect(sent).toEqual([]);
  });
});
