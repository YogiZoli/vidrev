import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/db/client";
import { audits, quotaLedger } from "@/db/schema";
import { parseChannelInput } from "@/lib/audit/handle";
import { pacificDate } from "@/lib/time";
import { runMigrations } from "@/scripts/migrate";
import { API_DATA_TTL_MS, createAudit } from "@/server/audit/service";
import { type AuditDeps, failStuckAudits, runAudit, scrubAudits } from "./audit";

const hasDb = Boolean(process.env.DATABASE_URL);
const db = () => getDb();
const CREATOR = "UCcreator000000000000000a";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

interface Options {
  channelFound?: boolean;
  commentsDisabled?: boolean;
  calls?: string[];
}

// A fake YouTube API: two videos, one page of comments each.
function youtube(options: Options = {}): AuditDeps["fetch"] {
  return async (input) => {
    const url = new URL(input);
    const path = url.pathname.replace("/youtube/v3", "");
    options.calls?.push(path);
    if (url.searchParams.get("key") !== "test-key") return json({ error: { errors: [{ reason: "keyInvalid" }] } }, 400);
    if (path === "/channels") {
      if (options.channelFound === false) return json({ items: [] });
      return json({
        items: [{ id: CREATOR, snippet: { title: "Coach Jane", description: "Free guide https://go.coach.com/guide" }, contentDetails: { relatedPlaylists: { uploads: "UUuploads" } } }],
      });
    }
    if (path === "/playlistItems") return json({ items: [{ contentDetails: { videoId: "vid1" } }, { contentDetails: { videoId: "vid2" } }] });
    if (path === "/videos") {
      return json({
        items: [
          { id: "vid1", snippet: { title: "Video one", description: "Get it: https://go.coach.com/guide?utm_source=youtube" } },
          { id: "vid2", snippet: { title: "Video two", description: "No link here" } },
        ],
      });
    }
    if (path === "/commentThreads") {
      if (options.commentsDisabled) return json({ error: { errors: [{ reason: "commentsDisabled" }] } }, 403);
      const video = url.searchParams.get("videoId");
      return json({
        items: [
          { id: `${video}-a`, snippet: { totalReplyCount: 0, topLevelComment: { snippet: { textDisplay: "How much is the course?", authorChannelId: { value: "UCviewer1" } } } } },
          {
            id: `${video}-b`,
            snippet: { totalReplyCount: 1, topLevelComment: { snippet: { textDisplay: "Where can I buy the template?", authorChannelId: { value: "UCviewer2" } } } },
            replies: { comments: [{ snippet: { authorChannelId: { value: CREATOR } } }] },
          },
          { id: `${video}-c`, snippet: { totalReplyCount: 0, topLevelComment: { snippet: { textDisplay: "Great video guide", authorChannelId: { value: "UCviewer3" } } } } },
        ],
      });
    }
    return json({}, 404);
  };
}

function deps(over: Partial<AuditDeps> = {}): AuditDeps {
  return {
    db: db(),
    fetch: youtube(),
    apiKey: "test-key",
    dailyLimit: 1_000_000,
    fetchPage: async (url) => ({ finalUrl: url, status: 200, body: '<script src="https://widgets.leadconnectorhq.com/loader.js"></script>' }),
    resolveCname: async () => [],
    ...over,
  };
}

async function newAudit(name = `coach${randomUUID().replace(/-/g, "").slice(0, 12)}`) {
  const parsed = parseChannelInput(`@${name}`);
  if (!parsed.ok) throw new Error("bad test handle");
  const { audit } = await createAudit(db(), parsed.ref, `@${name}`);
  return { audit, name, ref: parsed.ref };
}

async function row(id: string) {
  const [r] = await db().select().from(audits).where(eq(audits.id, id));
  return r!;
}

describe.skipIf(!hasDb)("audit my channel (integration)", () => {
  beforeAll(async () => {
    await runMigrations(process.env.DATABASE_URL!);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("audits a channel: numbers, stack, quota in the audit project, no comment text stored", async () => {
    const calls: string[] = [];
    const { audit } = await newAudit();
    await runAudit(deps({ fetch: youtube({ calls }) }), audit.id);
    const done = await row(audit.id);
    expect(done.status).toBe("done");
    expect(done.youtubeChannelId).toBe(CREATOR);
    const result = done.result!;
    expect(result.sample).toEqual({ videos: 2, comments: 6, commentsOffVideos: 0 });
    // per video: 1 unanswered buying question, 1 answered buying question
    expect(result.buying).toEqual({ total: 4, answered: 2, unanswered: 2, unknown: 0 });
    expect(result.links).toMatchObject({ videosChecked: 2, videosWithLink: 1, linksFound: 2 });
    expect(result.stack.segment).toBe("ghl");
    expect(result.score.value).not.toBeNull();
    expect(done.examples!.videos).toEqual([
      { id: "vid1", title: "Video one" },
      { id: "vid2", title: "Video two" },
    ]);
    expect(JSON.stringify(done)).not.toContain("How much is the course");
    expect(done.fetchedAt).not.toBeNull();
    expect(calls.filter((c) => c === "/commentThreads")).toHaveLength(2);

    const [ledger] = await db()
      .select({ units: sql<number>`sum(${quotaLedger.units})::int` })
      .from(quotaLedger)
      .where(and(eq(quotaLedger.gcpProject, "audit"), eq(quotaLedger.datePt, pacificDate(new Date()))));
    expect(ledger!.units).toBeGreaterThanOrEqual(5);
  });

  it("serves a second request for the same channel from the 24h cache without any API call", async () => {
    const first = await newAudit();
    await runAudit(deps(), first.audit.id);
    const second = await createAudit(db(), first.ref, `@${first.name}`);
    expect(second.cached).toBe(true);
    expect(second.audit.id).not.toBe(first.audit.id);
    expect(second.audit.status).toBe("done");
    expect(second.audit.result).toEqual((await row(first.audit.id)).result);
    expect(second.audit.fetchedAt).toEqual((await row(first.audit.id)).fetchedAt);
  });

  it("fails honestly when the channel does not exist", async () => {
    const { audit } = await newAudit();
    await runAudit(deps({ fetch: youtube({ channelFound: false }) }), audit.id);
    expect(await row(audit.id)).toMatchObject({ status: "failed", failureReason: "not_found" });
  });

  it("fails as busy, without spending, when the audit budget is used up", async () => {
    const { audit } = await newAudit();
    await runAudit(deps({ dailyLimit: 1, fetch: youtube() }), audit.id);
    expect(await row(audit.id)).toMatchObject({ status: "failed", failureReason: "busy" });
  });

  it("fails without an API key", async () => {
    const { audit } = await newAudit();
    await runAudit(deps({ apiKey: null }), audit.id);
    expect(await row(audit.id)).toMatchObject({ status: "failed", failureReason: "not_configured" });
  });

  it("counts videos with comments turned off instead of inventing numbers", async () => {
    const { audit } = await newAudit();
    await runAudit(deps({ fetch: youtube({ commentsDisabled: true }) }), audit.id);
    const done = await row(audit.id);
    expect(done.status).toBe("done");
    expect(done.result!.sample).toMatchObject({ comments: 0, commentsOffVideos: 2 });
    expect(done.result!.findings[0]!.id).toBe("no_comments");
  });

  it("runs a request only once", async () => {
    const calls: string[] = [];
    const { audit } = await newAudit();
    await Promise.all([runAudit(deps({ fetch: youtube({ calls }) }), audit.id), runAudit(deps({ fetch: youtube({ calls }) }), audit.id)]);
    expect(calls.filter((c) => c === "/channels")).toHaveLength(1);
  });

  it("wipes API-derived data after 30 days and keeps the counts", async () => {
    const { audit } = await newAudit();
    await runAudit(deps(), audit.id);
    const later = new Date(Date.now() + API_DATA_TTL_MS + 3_600_000);
    expect(await scrubAudits(db(), later, API_DATA_TTL_MS)).toBeGreaterThanOrEqual(1);
    const scrubbed = await row(audit.id);
    expect(scrubbed.examples).toBeNull();
    expect(scrubbed.youtubeChannelId).toBeNull();
    expect(scrubbed.apiDataScrubbedAt).not.toBeNull();
    expect(scrubbed.result!.score).toBeDefined();
  });

  it("fails a request that never finished", async () => {
    const { audit } = await newAudit();
    await failStuckAudits(db(), new Date(Date.now() + 11 * 60_000));
    expect(await row(audit.id)).toMatchObject({ status: "failed", failureReason: "error" });
  });
});
