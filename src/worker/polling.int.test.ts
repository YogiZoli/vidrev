import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/db/client";
import { accounts, campaigns, channels, comments, quotaLedger, videos } from "@/db/schema";
import { encryptSecret } from "@/lib/crypto";
import { runMigrations } from "@/scripts/migrate";
import { createAccountWithUser } from "@/server/accounts";
import { applyFeedEntries } from "@/server/uploads";
import { activeChannels, checkRss, type EngineDeps, engineTick, pollChannel } from "./polling";

const hasDb = Boolean(process.env.DATABASE_URL);
const key = randomBytes(32).toString("base64");
const now = new Date("2026-09-25T12:00:00Z");
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000).toISOString();

interface Sent {
  queue: string;
  data: unknown;
}

function thread(id: string, text: string, publishedAt: string, author = "UCviewer", videoId = "VID1") {
  return {
    id,
    snippet: {
      videoId,
      topLevelComment: { id, snippet: { textOriginal: text, authorDisplayName: "Viewer", authorChannelId: { value: author }, publishedAt } },
    },
  };
}

function engine(pages: unknown[][], opts: { quotaLimit?: number; refuseFromPage?: number } = {}) {
  const sent: Sent[] = [];
  const urls: string[] = [];
  let page = 0;
  const fetchImpl = async (url: string) => {
    urls.push(url);
    if (url.includes("/commentThreads?")) {
      if (opts.refuseFromPage !== undefined && page >= opts.refuseFromPage) {
        return Response.json({ error: { errors: [{ reason: "quotaExceeded" }] } }, { status: 403 });
      }
      const items = pages[page] ?? [];
      page += 1;
      return Response.json({ items, ...(page < pages.length ? { nextPageToken: `p${page}` } : {}) });
    }
    if (url.includes("/videos?")) return Response.json({ items: [{ id: "VID1", snippet: { title: "My video", publishedAt: minutesAgo(600) } }] });
    return new Response("not found", { status: 404 });
  };
  const deps: EngineDeps = {
    db: getDb(),
    fetch: fetchImpl,
    encryptionKey: key,
    google: { clientId: "cid", clientSecret: "cs" },
    now: () => now,
    quotaLimit: opts.quotaLimit ?? 1_000_000,
    enqueue: async (queue, data) => {
      sent.push({ queue, data });
    },
  };
  return { deps, sent, urls };
}

async function setup(campaignCreatedAt = new Date(now.getTime() - 3_600_000)) {
  const db = getDb();
  const { account } = await createAccountWithUser(db, { email: `poll-${randomUUID()}@example.com`, planCode: "standard_monthly" });
  // Onboarding done (Phase 14): polling and drafts run only after it.
  await db.update(accounts).set({ onboardedAt: new Date() }).where(eq(accounts.id, account.id));
  const ytId = `UC${randomUUID()}`;
  const [channel] = await db
    .insert(channels)
    .values({
      accountId: account.id,
      youtubeChannelId: ytId,
      status: "connected",
      refreshTokenEnc: encryptSecret("refresh", key),
      accessTokenEnc: encryptSecret("access", key),
      tokenExpiresAt: new Date(now.getTime() + 3_600_000),
    })
    .returning();
  await db.insert(campaigns).values({
    accountId: account.id,
    channelId: channel!.id,
    name: "Guide",
    keyword: "guide",
    destinationUrl: "https://example.com/optin",
    createdAt: campaignCreatedAt,
  });
  return { account, channel: channel!, ytId };
}

describe.skipIf(!hasDb)("channel polling (integration)", () => {
  beforeAll(async () => {
    await runMigrations(process.env.DATABASE_URL!);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("never polls or calls YouTube for an account that has not finished onboarding", async () => {
    const { account, channel } = await setup();
    await getDb().update(accounts).set({ onboardedAt: null }).where(eq(accounts.id, account.id));
    expect((await activeChannels(getDb())).some((c) => c.id === channel.id)).toBe(false);
    const { deps, urls } = engine([[thread(`c-${randomUUID()}`, "GUIDE please", minutesAgo(5))]]);
    await pollChannel(deps, channel.id);
    await checkRss(deps, channel.id);
    expect(urls).toEqual([]);
  });

  it("stores only new keyword comments from viewers and queues a draft for each", async () => {
    const { account, channel, ytId } = await setup();
    const id = () => `c-${randomUUID()}`;
    const match = id();
    const { deps, sent } = engine([
      [
        thread(match, "Please send the GUIDE", minutesAgo(5)),
        thread(id(), "nice video", minutesAgo(6)),
        thread(id(), "guide link below", minutesAgo(7), ytId),
        thread(id(), "old guide comment", minutesAgo(120)),
      ],
    ]);
    await pollChannel(deps, channel.id);

    const stored = await getDb().select().from(comments).where(eq(comments.channelId, channel.id));
    expect(stored.map((c) => c.youtubeCommentId)).toEqual([match]);
    expect(sent).toEqual([{ queue: "reply.draft", data: { commentId: stored[0]!.id } }]);

    const ledger = await getDb().select().from(quotaLedger).where(eq(quotaLedger.accountId, account.id));
    expect(ledger.map((l) => l.method).sort()).toEqual(["commentThreads.list", "videos.list"]);
    const [video] = await getDb().select().from(videos).where(eq(videos.channelId, channel.id));
    expect(video).toMatchObject({ youtubeVideoId: "VID1", title: "My video" });

    const [row] = await getDb().select().from(channels).where(eq(channels.id, channel.id));
    expect(row!.commentCursor).toEqual(new Date(minutesAgo(5)));
    expect(row!.nextPollAt).toEqual(new Date(now.getTime() + 15 * 60_000));

    // A second poll sees the same comments and stores nothing new.
    const again = engine([[thread(match, "Please send the GUIDE", minutesAgo(5))]]);
    await pollChannel(again.deps, channel.id);
    expect(again.sent).toEqual([]);
  });

  it("polls an account on FAST_POLL_ACCOUNTS again after one minute", async () => {
    const { account, channel } = await setup();
    const { deps } = engine([[]]);
    await pollChannel({ ...deps, fastPollAccounts: `other@example.com, ${account.id}` }, channel.id);
    const [row] = await getDb().select().from(channels).where(eq(channels.id, channel.id));
    expect(row!.nextPollAt).toEqual(new Date(now.getTime() + 60_000));
  });

  it("pages until it reaches the cursor", async () => {
    const { channel } = await setup();
    const { deps, sent, urls } = engine([
      [thread(`c-${randomUUID()}`, "guide", minutesAgo(1))],
      [thread(`c-${randomUUID()}`, "guide", minutesAgo(2))],
      [thread(`c-${randomUUID()}`, "guide", minutesAgo(200))],
    ]);
    await pollChannel(deps, channel.id);
    expect(urls.filter((u) => u.includes("/commentThreads?"))).toHaveLength(3);
    expect(sent).toHaveLength(2);
  });

  it("keeps the cursor when YouTube stops the pages early, so no new comment is lost", async () => {
    const { channel } = await setup();
    const [before] = await getDb().select().from(channels).where(eq(channels.id, channel.id));
    const newest = thread(`c-${randomUUID()}`, "guide please", minutesAgo(2));
    const older = thread(`c-${randomUUID()}`, "GUIDE", minutesAgo(20));
    const pages = [[newest], [older]];

    const stopped = engine(pages, { refuseFromPage: 1 });
    await pollChannel(stopped.deps, channel.id);
    expect(stopped.sent).toHaveLength(1);
    const [afterStop] = await getDb().select().from(channels).where(eq(channels.id, channel.id));
    // Not moved past the unread page.
    expect(afterStop!.commentCursor?.getTime() ?? null).not.toBe(new Date(minutesAgo(2)).getTime());
    expect(afterStop!.commentCursor ?? before!.commentCursor).not.toBeNull();

    const full = engine(pages);
    await pollChannel(full.deps, channel.id);
    // The older comment is drafted now; the newest one is not drafted twice.
    expect(full.sent).toHaveLength(1);
    const stored = await getDb().select().from(comments).where(eq(comments.channelId, channel.id));
    expect(stored.map((c) => c.youtubeCommentId).sort()).toEqual([newest.id, older.id].sort());
    const [afterFull] = await getDb().select().from(channels).where(eq(channels.id, channel.id));
    expect(afterFull!.commentCursor).toEqual(new Date(minutesAgo(2)));
  });

  it("skips the poll without calling YouTube when the read budget is used up", async () => {
    const { channel } = await setup();
    const { deps, urls } = engine([[thread(`c-${randomUUID()}`, "guide", minutesAgo(1))]], { quotaLimit: 0 });
    await pollChannel(deps, channel.id);
    expect(urls).toEqual([]);
    const [row] = await getDb().select().from(channels).where(eq(channels.id, channel.id));
    expect(row!.nextPollAt).not.toBeNull();
  });

  it("switches to the 2-minute tier after a new upload and queues the poll", async () => {
    const { channel, ytId } = await setup();
    const fresh = await applyFeedEntries(
      getDb(),
      channel,
      [{ videoId: "NEW1", channelId: ytId, title: "New upload", published: new Date(now.getTime() - 60_000) }],
      now,
    );
    expect(fresh).toBe(true);
    const [row] = await getDb().select().from(channels).where(eq(channels.id, channel.id));
    expect(row!.freshUntil).toEqual(new Date(now.getTime() - 60_000 + 48 * 3_600_000));

    const { deps, sent } = engine([[]]);
    await engineTick(deps);
    expect(sent).toContainEqual({ queue: "channel.poll", data: { channelId: channel.id } });

    await pollChannel(deps, channel.id);
    const [after] = await getDb().select().from(channels).where(eq(channels.id, channel.id));
    expect(after!.nextPollAt).toEqual(new Date(now.getTime() + 2 * 60_000));
  });

  it("does not poll channels without an enabled campaign", async () => {
    const { channel } = await setup();
    await getDb().update(campaigns).set({ active: false }).where(eq(campaigns.channelId, channel.id));
    const { deps, urls, sent } = engine([[]]);
    await pollChannel(deps, channel.id);
    await engineTick(deps);
    expect(urls).toEqual([]);
    expect(sent.some((s) => (s.data as { channelId?: string }).channelId === channel.id)).toBe(false);
  });
});
