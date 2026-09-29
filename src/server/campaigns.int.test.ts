import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/db/client";
import { campaigns, channels, customDomains, videos } from "@/db/schema";
import { encryptSecret } from "@/lib/crypto";
import { runMigrations } from "@/scripts/migrate";
import { createAccountWithUser } from "./accounts";
import { createCampaign, overlaps } from "./campaigns";
import { findOwnHostDestinations, OWN_HOST_ERROR } from "./own-hosts";
import { clearVideoCache, pickableVideos } from "./video-picker";

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

  it("refuses a destination on our own app, link or tracked-link host, and finds old ones", async () => {
    const { db, account, channel } = await setup();
    process.env.APP_BASE_URL = "https://app.vidrev.test";
    process.env.LINK_FALLBACK_BASE_URL = "https://go.vidrev.test";
    const own = `links-${randomUUID().slice(0, 8)}.creator.test`;
    await db.insert(customDomains).values({ accountId: account.id, hostname: own });
    for (const url of ["https://app.vidrev.test/optin", "https://GO.vidrev.test/x", `https://${own}/guide`]) {
      expect(await createCampaign(db, account.id, { ...input, channelId: channel.id, allVideos: true, destinationUrl: url })).toEqual({ ok: false, error: OWN_HOST_ERROR });
    }
    expect(await createCampaign(db, account.id, { ...input, channelId: channel.id, allVideos: true, destinationUrl: "https://vidrev.test/optin" })).toEqual({ ok: true });

    const before = await findOwnHostDestinations(db);
    await db.update(campaigns).set({ destinationUrl: "https://app.vidrev.test/optin" }).where(eq(campaigns.accountId, account.id));
    expect(await findOwnHostDestinations(db)).toBe(before + 1);
  });

  it("refuses a second rule for the same keyword on a video it already watches", async () => {
    const { db, account, channel } = await setup();
    const base = { ...input, channelId: channel.id };
    expect(await createCampaign(db, account.id, { ...base, videoIds: ["aaaaaaaaaaa"] })).toEqual({ ok: true });
    // Same keyword, other video: fine. Other keyword, same video: fine.
    expect(await createCampaign(db, account.id, { ...base, videoIds: ["bbbbbbbbbbb"] })).toEqual({ ok: true });
    expect(await createCampaign(db, account.id, { ...base, keyword: "CALL", videoIds: ["aaaaaaaaaaa"] })).toEqual({ ok: true });
    const overlap = await createCampaign(db, account.id, { ...base, videoIds: ["ccccccccccc", "aaaaaaaaaaa"] });
    expect(overlap).toMatchObject({ ok: false });
    expect((overlap as { error: string }).error).toContain("GUIDE is already watched on some of these videos");
    const all = await createCampaign(db, account.id, { ...base, allVideos: true });
    expect((all as { error: string }).error).toContain("GUIDE is already watched on these videos");
  });

  it("lists the channel's uploads with views and comments, caches them, and falls back to known videos", async () => {
    const { db, channel, ytId } = await setup();
    const key = randomBytes(32).toString("base64");
    await db
      .update(channels)
      .set({ accessTokenEnc: encryptSecret("access", key), tokenExpiresAt: new Date(Date.now() + 3_600_000) })
      .where(eq(channels.id, channel.id));
    await db.insert(videos).values({ channelId: channel.id, youtubeVideoId: "known000001", title: "Known", publishedAt: new Date("2026-01-01T00:00:00Z") });
    const calls: string[] = [];
    const deps = (fetchImpl: (url: string) => Promise<Response>) => ({
      db,
      fetch: async (url: string) => {
        calls.push(url);
        return fetchImpl(url);
      },
      encryptionKey: key,
      google: { clientId: "c", clientSecret: "s" },
      quotaLimit: 1_000_000,
    });
    const api = async (url: string) => {
      if (url.includes("/playlistItems?")) {
        expect(url).toContain(`playlistId=UU${ytId.slice(2)}`);
        return Response.json({ items: [{ contentDetails: { videoId: "vid00000001" } }, { contentDetails: { videoId: "vid00000002" } }] });
      }
      return Response.json({
        items: [
          { id: "vid00000001", snippet: { title: "First", publishedAt: "2026-03-01T00:00:00Z" }, statistics: { viewCount: "1200", commentCount: "34" } },
          { id: "vid00000002", snippet: { title: "Second", publishedAt: "2026-02-01T00:00:00Z" }, statistics: { viewCount: "50" } },
        ],
      });
    };
    clearVideoCache();
    const list = await pickableVideos(db, channel.id, deps(api));
    expect(list.source).toBe("youtube");
    expect(list.videos.map((v) => [v.youtubeVideoId, v.title, v.views, v.comments])).toEqual([
      ["vid00000001", "First", 1200, 34],
      ["vid00000002", "Second", 50, null],
    ]);
    // Cached: the second open costs nothing.
    await pickableVideos(db, channel.id, deps(api));
    expect(calls).toHaveLength(2);

    clearVideoCache();
    const offline = await pickableVideos(
      db,
      channel.id,
      deps(async () => {
        throw new Error("offline");
      }),
    );
    expect(offline).toEqual({ source: "known", videos: [expect.objectContaining({ youtubeVideoId: "known000001", views: null })] });
  });
});

describe("overlaps", () => {
  it("treats all videos as overlapping everything", () => {
    expect(overlaps(null, ["a"])).toBe(true);
    expect(overlaps(["a"], null)).toBe(true);
    expect(overlaps(["a", "b"], ["b"])).toBe(true);
    expect(overlaps(["a"], ["b"])).toBe(false);
  });
});
