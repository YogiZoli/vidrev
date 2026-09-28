import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/db/client";
import { campaigns, channels, videos } from "@/db/schema";
import { runMigrations } from "@/scripts/migrate";
import { createAccountWithUser } from "./accounts";
import { createCampaign } from "./campaigns";
import { pickableVideos } from "./video-picker";

const hasDb = Boolean(process.env.DATABASE_URL);

async function setup() {
  const db = getDb();
  const { account } = await createAccountWithUser(db, { email: `camp-${randomUUID()}@example.com`, planCode: "standard_monthly" });
  const ytId = `UC${randomUUID()}`;
  const [channel] = await db.insert(channels).values({ accountId: account.id, youtubeChannelId: ytId, status: "connected" }).returning();
  return { db, account, channel: channel!, ytId };
}

const input = { name: "", keyword: "GUIDE", aliases: "", intent: "warm", destinationUrl: "https://example.com/guide", videos: "" };

describe.skipIf(!hasDb)("campaigns (integration)", () => {
  beforeAll(async () => {
    await runMigrations(process.env.DATABASE_URL!);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("refuses a new rule without a video and stores picked plus pasted videos", async () => {
    const { db, account, channel } = await setup();
    expect(await createCampaign(db, account.id, { ...input, channelId: channel.id })).toEqual({ ok: false, error: "Pick at least one video, or all of them." });
    expect(await createCampaign(db, account.id, { ...input, channelId: channel.id, videoIds: ["bad"] })).toMatchObject({ ok: false });
    const result = await createCampaign(db, account.id, {
      ...input,
      channelId: channel.id,
      videoIds: ["aaaaaaaaaaa", "bbbbbbbbbbb"],
      videos: "https://youtu.be/ccccccccccc https://youtu.be/aaaaaaaaaaa",
    });
    expect(result).toEqual({ ok: true });
    const [row] = await db.select().from(campaigns).where(eq(campaigns.accountId, account.id));
    expect(row?.videoIds).toEqual(["aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc"]);
  });

  it("takes keywords only from the catalog, with its temperature and automatic misspellings, and allows all videos", async () => {
    const { db, account, channel } = await setup();
    expect(await createCampaign(db, account.id, { ...input, keyword: "MYWORD", channelId: channel.id, allVideos: true })).toEqual({
      ok: false,
      error: "Pick a keyword from the list.",
    });
    expect(await createCampaign(db, account.id, { ...input, keyword: "buy", intent: "cold", channelId: channel.id, allVideos: true })).toEqual({ ok: true });
    expect(await createCampaign(db, account.id, { ...input, aliases: "gudie, guidd", channelId: channel.id, allVideos: true })).toEqual({ ok: true });
    const rows = await db.select().from(campaigns).where(eq(campaigns.accountId, account.id));
    const price = rows.find((r) => r.keyword === "BUY")!;
    expect(price).toMatchObject({ intent: "hot", videoIds: null });
    expect(price.aliases).toContain("BUYS");
    expect(rows.find((r) => r.keyword === "GUIDE")?.aliases).toEqual(["GUDIE", "GUIDD"]);
  });

  it("lists feed videos and known videos newest first, without duplicates", async () => {
    const { db, channel, ytId } = await setup();
    await db.insert(videos).values([
      { channelId: channel.id, youtubeVideoId: "known000001", title: "Known", publishedAt: new Date("2026-01-01T00:00:00Z") },
      { channelId: channel.id, youtubeVideoId: "both0000001", title: "Old title", publishedAt: new Date("2026-02-01T00:00:00Z") },
    ]);
    const entry = (id: string, title: string, date: string) =>
      `<entry><yt:videoId>${id}</yt:videoId><yt:channelId>${ytId}</yt:channelId><title>${title}</title><published>${date}</published></entry>`;
    const feed = `<feed>${entry("feed0000001", "Newest", "2026-03-01T00:00:00Z")}${entry("both0000001", "Feed title", "2026-02-01T00:00:00Z")}</feed>`;
    const list = await pickableVideos(db, channel, async () => new Response(feed));
    expect(list.map((v) => [v.youtubeVideoId, v.title])).toEqual([
      ["feed0000001", "Newest"],
      ["both0000001", "Feed title"],
      ["known000001", "Known"],
    ]);
    const offline = await pickableVideos(db, channel, async () => {
      throw new Error("offline");
    });
    expect(offline.map((v) => v.youtubeVideoId)).toEqual(["both0000001", "known000001"]);
  });
});
