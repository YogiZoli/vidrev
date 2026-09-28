import { and, eq, inArray, isNotNull, isNull, lt } from "drizzle-orm";
import type { Db } from "@/db/client";
import { audits } from "@/db/schema";
import { analyzeComments, type AuditThread } from "@/lib/audit/comments";
import { parseChannelInput } from "@/lib/audit/handle";
import { extractLinks, hostOf, isHubHost, isOwnDomain, isSkippedHost, MAX_LINKS, measuredBy } from "@/lib/audit/links";
import type { AuditExamples } from "@/lib/audit/result";
import { buildResult } from "@/lib/audit/score";
import { type Detection, detectStack, mergeDetections } from "@/lib/audit/stack";
import { errorFields, log } from "@/lib/log";
import type { PageFetcher } from "@/server/audit/fetch-page";
import { findCachedAudit } from "@/server/audit/service";
import type { FetchLike } from "@/server/google/oauth";
import { reserveUnits } from "@/server/quota";
import { AuditApiError, findChannel, latestUploadIds, type RawThread, videoDetails, videoThreads } from "@/server/youtube/audit-api";

// Audit my channel, worker side (DECISIONS section 16). All YouTube calls use
// the audit project's key and quota; all page fetches go through the guarded
// fetcher. Comment text is analysed in memory and never stored (P9-07).

export interface AuditDeps {
  db: Db;
  fetch: FetchLike;
  apiKey: string | null;
  dailyLimit: number;
  fetchPage: PageFetcher;
  resolveCname: (host: string) => Promise<string[]>;
  now?: () => Date;
}

export const VIDEOS_PER_AUDIT = 5;
const PAGES_PER_VIDEO = 2;
const HUB_EXPANSION_LIMIT = 8;

class Busy extends Error {}

function toThread(videoId: string, raw: RawThread): AuditThread {
  const top = raw.snippet.topLevelComment?.snippet;
  return {
    videoId,
    commentId: raw.id,
    text: top?.textDisplay ?? top?.textOriginal ?? "",
    authorChannelId: top?.authorChannelId?.value ?? null,
    totalReplyCount: raw.snippet.totalReplyCount ?? 0,
    replyAuthorIds: (raw.replies?.comments ?? []).map((c) => c.snippet?.authorChannelId?.value).filter((id): id is string => Boolean(id)),
  };
}

const HREF = /href="(https?:\/\/[^"]+)"/gi;

interface LinkOutcome {
  url: string;
  finalHost: string | null;
  measured: "utm" | "click_tracker" | null;
  ownDomain: boolean;
  detections: Detection[];
  checked: boolean;
}

async function inspectLink(deps: AuditDeps, url: string): Promise<{ outcome: LinkOutcome; hubLinks: string[] }> {
  const page = await deps.fetchPage(url);
  const finalHost = hostOf(page.finalUrl) ?? hostOf(url);
  let detections = detectStack({ finalUrl: page.finalUrl, body: page.body, cnames: [] });
  if (finalHost && !detections.some((d) => d.id === "ghl") && isOwnDomain(finalHost)) {
    const cnames = await deps.resolveCname(finalHost).catch((error: unknown) => {
      const code = (error as { code?: string }).code;
      if (code !== "ENODATA" && code !== "ENOTFOUND") log("warn", "audit CNAME lookup failed", { host: finalHost, ...errorFields(error) });
      return [] as string[];
    });
    if (cnames.length > 0) detections = detectStack({ finalUrl: page.finalUrl, body: page.body, cnames });
  }
  const hubLinks: string[] = [];
  if (finalHost && isHubHost(finalHost) && page.body) {
    for (const match of page.body.matchAll(HREF)) {
      const href = match[1]!;
      const host = hostOf(href);
      if (host && !isSkippedHost(host) && !isHubHost(host) && !hubLinks.includes(href)) hubLinks.push(href);
      if (hubLinks.length >= 15) break;
    }
  }
  return {
    outcome: {
      url,
      finalHost,
      measured: measuredBy(url),
      ownDomain: finalHost ? isOwnDomain(finalHost) : false,
      detections,
      checked: page.status !== 0,
    },
    hubLinks,
  };
}

export async function runAudit(deps: AuditDeps, auditId: string): Promise<void> {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());
  const [claimed] = await db
    .update(audits)
    .set({ status: "running" })
    .where(and(eq(audits.id, auditId), eq(audits.status, "queued")))
    .returning();
  if (!claimed) return;

  const fail = async (reason: string) => {
    await db.update(audits).set({ status: "failed", failureReason: reason }).where(eq(audits.id, auditId));
  };

  try {
    const cached = await findCachedAudit(db, claimed.channelKey, now(), auditId);
    if (cached) {
      await db
        .update(audits)
        .set({ status: "done", youtubeChannelId: cached.youtubeChannelId, result: cached.result, examples: cached.examples, fetchedAt: cached.fetchedAt })
        .where(eq(audits.id, auditId));
      return;
    }
    if (!deps.apiKey) return await fail("not_configured");
    const apiKey = deps.apiKey;
    const parsed = parseChannelInput(claimed.channelInput);
    if (!parsed.ok) return await fail("bad_input");

    const spend = async (method: "channels.list" | "playlistItems.list" | "videos.list" | "commentThreads.list") => {
      if (!(await reserveUnits(db, { method, accountId: null, limit: deps.dailyLimit, gcpProject: "audit" }, now()))) throw new Busy();
    };

    await spend("channels.list");
    const channel = await findChannel(deps.fetch, apiKey, parsed.ref);
    if (!channel) return await fail("not_found");
    if (!channel.uploadsPlaylistId) return await fail("no_videos");

    await spend("playlistItems.list");
    const videoIds = await latestUploadIds(deps.fetch, apiKey, channel.uploadsPlaylistId, VIDEOS_PER_AUDIT);
    if (videoIds.length === 0) return await fail("no_videos");

    await spend("videos.list");
    const videos = await videoDetails(deps.fetch, apiKey, videoIds);
    if (videos.length === 0) return await fail("no_videos");

    const threads: AuditThread[] = [];
    let commentsOff = 0;
    for (const video of videos) {
      let pageToken: string | undefined;
      for (let page = 0; page < PAGES_PER_VIDEO; page += 1) {
        await spend("commentThreads.list");
        try {
          const response = await videoThreads(deps.fetch, apiKey, video.id, pageToken);
          for (const raw of response.items ?? []) threads.push(toThread(video.id, raw));
          pageToken = response.nextPageToken;
        } catch (error) {
          if (error instanceof AuditApiError && error.commentsDisabled) commentsOff += 1;
          else if (error instanceof AuditApiError && error.quotaExceeded) throw new Busy();
          else if (!(error instanceof AuditApiError && error.videoGone)) throw error;
          pageToken = undefined;
          break;
        }
        if (!pageToken) break;
      }
    }
    const analysis = analyzeComments(threads, channel.id);

    // Links: channel description first, then the videos; coverage counts only
    // the video descriptions (03 research method).
    const descriptionLinks: string[] = [];
    let videosWithLink = 0;
    for (const link of extractLinks(channel.description)) if (!descriptionLinks.includes(link)) descriptionLinks.push(link);
    for (const video of videos) {
      const found = extractLinks(video.description);
      if (found.length > 0) videosWithLink += 1;
      for (const link of found) if (!descriptionLinks.includes(link)) descriptionLinks.push(link);
    }
    const toCheck = descriptionLinks.slice(0, MAX_LINKS);

    const outcomes: LinkOutcome[] = [];
    const extra: string[] = [];
    for (const url of toCheck) {
      const { outcome, hubLinks } = await inspectLink(deps, url);
      outcomes.push(outcome);
      for (const hub of hubLinks) if (extra.length < HUB_EXPANSION_LIMIT && !extra.includes(hub) && !toCheck.includes(hub)) extra.push(hub);
    }
    const expanded: LinkOutcome[] = [];
    for (const url of extra) expanded.push((await inspectLink(deps, url)).outcome);
    const everything = [...outcomes, ...expanded];
    const detected = mergeDetections(everything.flatMap((o) => o.detections));

    const links = {
      videosChecked: videos.length,
      videosWithLink,
      linksFound: toCheck.length,
      linksChecked: everything.filter((o) => o.checked).length,
      measured: outcomes.filter((o) => o.measured !== null).length,
      ownDomain: everything.filter((o) => o.ownDomain).length,
    };
    const result = buildResult({ analysis, links, detected, videos: videos.length, commentsOffVideos: commentsOff });
    const examples: AuditExamples = {
      channelTitle: channel.title,
      videos: videos.map((v) => ({ id: v.id, title: v.title })),
      questions: analysis.questionExamples,
      buying: analysis.buyingExamples,
      links: everything.map((o) => ({ url: o.url, finalHost: o.finalHost, measured: o.measured, ownDomain: o.ownDomain, stacks: o.detections.map((d) => d.label) })),
    };
    await db
      .update(audits)
      .set({ status: "done", result, examples, youtubeChannelId: channel.id, fetchedAt: now() })
      .where(eq(audits.id, auditId));
  } catch (error) {
    if (error instanceof Busy) return await fail("busy");
    log("error", "audit failed", { ...errorFields(error), auditId });
    await fail("error");
  }
}

// A run that never finished (worker restarted mid-audit) must not leave the
// visitor waiting: after 10 minutes the request is failed.
export async function failStuckAudits(db: Db, now: Date): Promise<void> {
  await db
    .update(audits)
    .set({ status: "failed", failureReason: "error" })
    .where(and(inArray(audits.status, ["queued", "running"]), lt(audits.createdAt, new Date(now.getTime() - 10 * 60_000))));
}

// 30-day rule (P9-07): API-derived data of audits is wiped once it is 30 days
// old; counts, the score and the requester stay.
export async function scrubAudits(db: Db, now: Date, ttlMs: number): Promise<number> {
  const rows = await db
    .update(audits)
    .set({ examples: null, youtubeChannelId: null, apiDataScrubbedAt: now })
    .where(and(isNotNull(audits.fetchedAt), lt(audits.fetchedAt, new Date(now.getTime() - ttlMs)), isNull(audits.apiDataScrubbedAt)))
    .returning({ id: audits.id });
  return rows.length;
}
