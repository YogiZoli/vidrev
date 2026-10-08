import { and, asc, eq, isNull, notInArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { accounts, campaigns, channels, type CardKeywordState, links, publishingCardKeywords, publishingCards, users } from "@/db/schema";
import { catalogKeyword, misspellings } from "@/lib/keyword-catalog";
import { linkUrl, newSlug } from "@/lib/links";
import { errorFields, log } from "@/lib/log";
import type { CardSummary } from "@/lib/publishing-card";
import type { SendEmailJob } from "@/jobs/queues";
import { type DbOrTx, writeAudit } from "./accounts";
import { overlaps } from "./campaigns";
import { cardArmedEmail } from "./email/templates";
import { linkHostFor } from "./links";
import { isOwnHost, ownHosts } from "./own-hosts";

// Video Publishing Cards from PDT (DECISIONS A-31 to A-34). A card becomes a
// waiting automation: one tracked link per keyword at once, no campaign, so
// nothing is polled, drafted or spent. When PDT reports the published video,
// each keyword goes live on that video (one rule per keyword and video, RR-07).

export type ApiError = { ok: false; status: number; error: string };

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

function validUrl(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

// Where a card keyword's link leads, in this order (A-32): (a) the account's
// live "All my videos" automation for the same keyword, (b) the card's
// landingUrl, (c) the account's default target URL. Never one of our own hosts.
export async function pickTarget(
  db: DbOrTx,
  input: { accountId: string; keyword: string; landingUrl: string | null; defaultTargetUrl: string | null; hosts: readonly string[] },
): Promise<string | null> {
  const allVideos = await db
    .select({ url: campaigns.destinationUrl })
    .from(campaigns)
    .where(and(eq(campaigns.accountId, input.accountId), eq(campaigns.active, true), isNull(campaigns.videoIds), sql`upper(${campaigns.keyword}) = ${input.keyword}`))
    .orderBy(asc(campaigns.createdAt));
  const candidates = [...allVideos.map((c) => c.url), input.landingUrl, input.defaultTargetUrl];
  return candidates.find((url) => validUrl(url) && !isOwnHost(url, input.hosts)) ?? null;
}

export const NO_TARGET = "There is no address to send viewers to: add landingUrl to the card, or set a default target URL in vidrev.";

export type SaveResult = { ok: true; created: boolean; cardId: string; links: { keyword: string; url: string }[] } | ApiError;

export async function saveCard(
  db: Db,
  account: typeof accounts.$inferSelect,
  card: { raw: Record<string, unknown>; summary: CardSummary },
  options: { fallbackHost: string | null },
  now = new Date(),
): Promise<SaveResult> {
  const { summary } = card;
  const hosts = await ownHosts(db, account.id);
  if (summary.landingUrl && isOwnHost(summary.landingUrl, hosts)) {
    return { ok: false, status: 422, error: "landingUrl is on vidrev's own link or app domain, so viewers would land on an error page. Use the opt-in page instead." };
  }
  const host = await linkHostFor(db, account.id, options.fallbackHost);
  if (!host) return { ok: false, status: 503, error: "Tracked links are not set up on this vidrev server yet. Try again later." };
  const targets = new Map<string, string>();
  for (const call of summary.calls) {
    const target = await pickTarget(db, { accountId: account.id, keyword: call.keyword, landingUrl: summary.landingUrl, defaultTargetUrl: account.defaultTargetUrl, hosts });
    if (!target) return { ok: false, status: 422, error: NO_TARGET };
    targets.set(call.keyword, target);
  }

  return db.transaction(async (tx) => {
    const [stored] = await tx
      .insert(publishingCards)
      .values({ accountId: account.id, cardId: summary.cardId, card: card.raw, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({ target: [publishingCards.accountId, publishingCards.cardId], set: { card: card.raw, updatedAt: now } })
      .returning({ id: publishingCards.id, created: sql<boolean>`(xmax = 0)` });
    const cardRowId = stored!.id;
    const existing = await tx.select().from(publishingCardKeywords).where(eq(publishingCardKeywords.cardRowId, cardRowId));
    const out: { keyword: string; url: string }[] = [];
    for (const call of summary.calls) {
      const row = existing.find((r) => r.keyword === call.keyword);
      const destinationUrl = targets.get(call.keyword)!;
      if (row) {
        // A waiting keyword follows the resent card; a live one keeps its target.
        const pending = row.state === "pending";
        await tx
          .update(publishingCardKeywords)
          .set({ gets: call.gets, ...(pending ? { intent: call.temperature } : {}), updatedAt: now })
          .where(eq(publishingCardKeywords.id, row.id));
        if (pending) await tx.update(links).set({ destinationUrl, intent: call.temperature, updatedAt: now }).where(eq(links.id, row.linkId));
        const [link] = await tx.select({ host: links.host, slug: links.slug }).from(links).where(eq(links.id, row.linkId));
        out.push({ keyword: call.keyword, url: linkUrl(link!.host, link!.slug) });
        continue;
      }
      let link: { id: string; host: string; slug: string } | undefined;
      for (let attempt = 0; attempt < 5 && !link; attempt += 1) {
        [link] = await tx
          .insert(links)
          .values({ accountId: account.id, kind: "card", slug: newSlug(), host, keyword: call.keyword, intent: call.temperature, destinationUrl, publishedAt: now, createdAt: now, updatedAt: now })
          .onConflictDoNothing()
          .returning({ id: links.id, host: links.host, slug: links.slug });
      }
      if (!link) throw new Error("could not allocate a link slug");
      await tx.insert(publishingCardKeywords).values({
        accountId: account.id,
        cardRowId,
        keyword: call.keyword,
        intent: call.temperature,
        gets: call.gets,
        linkId: link.id,
        createdAt: now,
        updatedAt: now,
      });
      out.push({ keyword: call.keyword, url: linkUrl(link.host, link.slug) });
    }
    // A keyword taken out of a resent card stops waiting. Its link keeps
    // redirecting (links never die); a keyword already live stays live.
    const keep = summary.calls.map((c) => c.keyword);
    await tx
      .delete(publishingCardKeywords)
      .where(
        and(
          eq(publishingCardKeywords.cardRowId, cardRowId),
          eq(publishingCardKeywords.state, "pending"),
          keep.length ? notInArray(publishingCardKeywords.keyword, keep) : sql`true`,
        ),
      );
    await writeAudit(tx, { actor: "pdt", accountId: account.id, action: stored!.created ? "card.created" : "card.updated", details: { cardId: summary.cardId, keywords: keep } });
    return { ok: true as const, created: Boolean(stored!.created), cardId: summary.cardId, links: out };
  });
}

export interface PublishOutcome {
  ok: true;
  armed: string[];
  alreadyLive: string[];
  notArmed: { keyword: string; reason: string }[];
}

export interface PublishDeps {
  db: Db;
  enqueueEmail: (job: SendEmailJob) => Promise<void>;
  appBaseUrl: string;
  productName: string;
}

// PDT reports the published video: every keyword of the card goes live on it.
// Idempotent: a second call finds the rules this card made. An existing rule
// for the same keyword and video (or all videos) is never duplicated (RR-07).
export async function publishCard(
  deps: PublishDeps,
  account: typeof accounts.$inferSelect,
  input: { cardId: string; videoId: string },
  now = new Date(),
): Promise<PublishOutcome | ApiError> {
  const { db } = deps;
  if (!VIDEO_ID.test(input.videoId)) return { ok: false, status: 400, error: "videoId must be the 11 character YouTube video id." };
  const [card] = await db
    .select()
    .from(publishingCards)
    .where(and(eq(publishingCards.accountId, account.id), sql`${publishingCards.cardId}::text = ${input.cardId.toLowerCase()}`));
  if (!card) return { ok: false, status: 404, error: "No card with this cardId. Send the card first (POST /api/v1/cards)." };
  if (card.youtubeVideoId && card.youtubeVideoId !== input.videoId) {
    return { ok: false, status: 409, error: `This card is already published as video ${card.youtubeVideoId}.` };
  }
  const [channel] = await db
    .select({ id: channels.id })
    .from(channels)
    .where(and(eq(channels.accountId, account.id), eq(channels.status, "connected")));
  if (!channel) return { ok: false, status: 409, error: "Connect your YouTube channel in vidrev first, then report the publish again." };
  const hosts = await ownHosts(db, account.id);
  const landingUrl = typeof card.card.landingUrl === "string" ? card.card.landingUrl : null;
  const videoId = input.videoId;

  const result = await db.transaction(async (tx) => {
    // One publish at a time per account, so parallel calls never make two rules.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${account.id}::text, 30))`);
    await tx
      .update(publishingCards)
      .set({ youtubeVideoId: videoId, publishedAt: card.publishedAt ?? now, updatedAt: now })
      .where(eq(publishingCards.id, card.id));
    // In the order the card names them.
    const order = (Array.isArray(card.card.commentCalls) ? card.card.commentCalls : []).map((c) => String((c as { keyword?: unknown })?.keyword ?? "").trim().toUpperCase());
    const position = (keyword: string) => (order.includes(keyword) ? order.indexOf(keyword) : order.length);
    const rows = (await tx.select().from(publishingCardKeywords).where(eq(publishingCardKeywords.cardRowId, card.id))).sort((a, b) => position(a.keyword) - position(b.keyword));
    const outcome: PublishOutcome = { ok: true, armed: [], alreadyLive: [], notArmed: [] };
    const changed: string[] = [];
    for (const row of rows) {
      const rules = await tx
        .select()
        .from(campaigns)
        .where(and(eq(campaigns.channelId, channel.id), sql`upper(${campaigns.keyword}) = ${row.keyword}`))
        .orderBy(asc(campaigns.createdAt));
      const own = rules.find((r) => r.publishingCardId === card.id && r.videoIds?.includes(videoId));
      const others = rules.filter((r) => r !== own && overlaps(r.videoIds, [videoId]));
      const live = others.find((r) => r.active);
      let state: CardKeywordState;
      let reason: string | null = null;
      let campaignId: string | null = own?.id ?? live?.id ?? null;
      const target = await pickTarget(tx, { accountId: account.id, keyword: row.keyword, landingUrl, defaultTargetUrl: account.defaultTargetUrl, hosts });
      if (own) state = "armed";
      else if (live) state = "already_live";
      else if (others.length > 0) {
        state = "not_armed";
        reason = `${row.keyword} is watched on this video by a paused automation. Resume it in vidrev.`;
      } else if (!target) {
        state = "not_armed";
        reason = NO_TARGET;
      } else {
        const [made] = await tx
          .insert(campaigns)
          .values({
            accountId: account.id,
            channelId: channel.id,
            // The catalog text, never card text: the name goes into the AI instructions.
            name: catalogKeyword(row.keyword)?.gets ?? row.keyword,
            keyword: row.keyword,
            aliases: misspellings(row.keyword),
            intent: row.intent,
            destinationUrl: target,
            videoIds: [videoId],
            publishingCardId: card.id,
            createdAt: now,
            updatedAt: now,
          })
          .returning({ id: campaigns.id });
        campaignId = made!.id;
        state = "armed";
      }
      // The link handed out with the card now belongs to this video.
      await tx
        .update(links)
        .set({ youtubeVideoId: videoId, campaignId, intent: row.intent, ...(target ? { destinationUrl: target } : {}), updatedAt: now })
        .where(eq(links.id, row.linkId));
      if (row.state !== state || row.youtubeVideoId !== videoId) changed.push(row.keyword);
      await tx
        .update(publishingCardKeywords)
        .set({ state, stateReason: reason, campaignId, youtubeVideoId: videoId, armedAt: state === "not_armed" ? null : (row.armedAt ?? now), updatedAt: now })
        .where(eq(publishingCardKeywords.id, row.id));
      if (state === "armed") outcome.armed.push(row.keyword);
      else if (state === "already_live") outcome.alreadyLive.push(row.keyword);
      else outcome.notArmed.push({ keyword: row.keyword, reason: reason! });
    }
    if (changed.length > 0) {
      await writeAudit(tx, { actor: "pdt", accountId: account.id, action: "card.published", details: { cardId: input.cardId, videoId, ...outcome, ok: undefined } });
    }
    return { outcome, changed };
  });

  if (result.changed.length > 0) {
    // Poll soon, so the first comments are seen quickly.
    if (result.outcome.armed.length > 0) await db.update(channels).set({ nextPollAt: null }).where(eq(channels.id, channel.id));
    await notifyArmed(deps, account.id, card.card, videoId, result.outcome);
  }
  return result.outcome;
}

function cardTitle(card: Record<string, unknown>): string | null {
  const video = card.video as Record<string, unknown> | undefined;
  const publish = card.publish as Record<string, unknown> | undefined;
  for (const value of [publish?.title, video?.title, video?.workingTitle]) {
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 200);
  }
  return null;
}

// The existing way vidrev tells a creator something: an email to the account's users.
async function notifyArmed(deps: PublishDeps, accountId: string, card: Record<string, unknown>, videoId: string, outcome: PublishOutcome): Promise<void> {
  const recipients = await deps.db.select({ email: users.email }).from(users).where(eq(users.accountId, accountId));
  for (const { email } of recipients) {
    try {
      await deps.enqueueEmail(
        cardArmedEmail({
          to: email,
          videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
          title: cardTitle(card),
          armed: outcome.armed,
          alreadyLive: outcome.alreadyLive,
          notArmed: outcome.notArmed,
          url: `${deps.appBaseUrl}/app/campaigns`,
          productName: deps.productName,
        }),
      );
    } catch (error) {
      log("warn", "card armed email not queued", { accountId, ...errorFields(error) });
    }
  }
}
