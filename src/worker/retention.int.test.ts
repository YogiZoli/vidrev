import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/db/client";
import { channels, comments, replies, videos } from "@/db/schema";
import { encryptSecret } from "@/lib/crypto";
import { runMigrations } from "@/scripts/migrate";
import { createAccountWithUser } from "@/server/accounts";
import type { EngineDeps } from "./polling";
import { runRetention } from "./retention";

const hasDb = Boolean(process.env.DATABASE_URL);
const key = randomBytes(32).toString("base64");
const now = new Date("2026-09-25T12:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);

describe.skipIf(!hasDb)("retention job (integration)", () => {
  beforeAll(async () => {
    await runMigrations(process.env.DATABASE_URL!);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("deletes YouTube data older than 30 days and keeps first-party replies", async () => {
    const db = getDb();
    const { account } = await createAccountWithUser(db, { email: `ret-${randomUUID()}@example.com`, planCode: "standard_monthly" });
    const [channel] = await db
      .insert(channels)
      .values({
        accountId: account.id,
        youtubeChannelId: `UC${randomUUID()}`,
        status: "connected",
        title: "Old title",
        titleRefreshedAt: daysAgo(31),
        accessTokenEnc: encryptSecret("a", key),
        refreshTokenEnc: encryptSecret("r", key),
        tokenExpiresAt: daysAgo(-1),
      })
      .returning();
    const [oldComment, newComment] = await db
      .insert(comments)
      .values([
        { channelId: channel!.id, youtubeCommentId: `o-${randomUUID()}`, youtubeVideoId: "V", text: "guide", authorName: "A", publishedAt: daysAgo(31), fetchedAt: daysAgo(31) },
        { channelId: channel!.id, youtubeCommentId: `n-${randomUUID()}`, youtubeVideoId: "V", text: "guide", publishedAt: daysAgo(1), fetchedAt: daysAgo(1) },
      ])
      .returning();
    await db.insert(videos).values({ channelId: channel!.id, youtubeVideoId: `v-${randomUUID()}`, title: "T", fetchedAt: daysAgo(40) });
    const base = { accountId: account.id, channelId: channel!.id, youtubeVideoId: "V", keyword: "guide", intent: "warm" as const, language: "en", body: "x {link}", draftSource: "template" as const };
    const [sent, pending] = await db
      .insert(replies)
      .values([
        { ...base, commentId: oldComment!.id, status: "sent", sentAt: daysAgo(31), youtubeReplyId: "yr1", createdAt: daysAgo(31) },
        { ...base, commentId: newComment!.id, status: "pending_approval", createdAt: daysAgo(31) },
      ])
      .returning();

    const deps: EngineDeps = {
      db,
      fetch: async () => Response.json({ items: [{ snippet: { title: "Fresh title" } }] }),
      encryptionKey: key,
      google: { clientId: "c", clientSecret: "s" },
      now: () => now,
      quotaLimit: 1_000_000_000,
      enqueue: async () => {},
    };
    await runRetention(deps);

    const left = await db.select().from(comments).where(eq(comments.channelId, channel!.id));
    expect(left.map((c) => c.id)).toEqual([newComment!.id]);
    expect(await db.select().from(videos).where(eq(videos.channelId, channel!.id))).toEqual([]);
    const [sentAfter] = await db.select().from(replies).where(eq(replies.id, sent!.id));
    expect(sentAfter).toMatchObject({ status: "sent", youtubeReplyId: null, commentId: null, body: "x {link}" });
    const [pendingAfter] = await db.select().from(replies).where(eq(replies.id, pending!.id));
    expect(pendingAfter!.status).toBe("expired");
    const [channelAfter] = await db.select().from(channels).where(eq(channels.id, channel!.id));
    expect(channelAfter).toMatchObject({ title: "Fresh title", titleRefreshedAt: now });
  });

  it("removes all YouTube data of a disconnected channel", async () => {
    const db = getDb();
    const { account } = await createAccountWithUser(db, { email: `ret-${randomUUID()}@example.com`, planCode: "standard_monthly" });
    const [channel] = await db.insert(channels).values({ accountId: account.id, status: "disconnected" }).returning();
    await db.insert(comments).values({ channelId: channel!.id, youtubeCommentId: `d-${randomUUID()}`, youtubeVideoId: "V", text: "t", publishedAt: now, fetchedAt: now });
    await runRetention({
      db,
      fetch: async () => new Response(null, { status: 500 }),
      encryptionKey: key,
      google: { clientId: "c", clientSecret: "s" },
      now: () => now,
      quotaLimit: 1_000_000_000,
      enqueue: async () => {},
    });
    expect(await db.select().from(comments).where(eq(comments.channelId, channel!.id))).toEqual([]);
  });
});
