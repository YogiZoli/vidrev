import { and, eq, isNull, ne } from "drizzle-orm";
import type { Db } from "@/db/client";
import { accounts, campaigns, clicks, customDomains, links, replies } from "@/db/schema";
import {
  classifyUserAgent,
  destinationWithTid,
  hashIp,
  isSlug,
  linkUrl,
  newSlug,
  newTid,
  tidCookie,
} from "@/lib/links";
import { pacificDate } from "@/lib/time";
import type { EventContext } from "@/lib/webhooks";

// Tracked links on the creator's own domain (D-33, D-38), fallback host for
// creators without a domain.

// The host new links are published on: the account's active custom domain,
// else the fallback host, else null (no link host configured yet).
export async function linkHostFor(db: Db, accountId: string, fallback: string | null): Promise<string | null> {
  const [domain] = await db
    .select({ hostname: customDomains.hostname })
    .from(customDomains)
    .where(and(eq(customDomains.accountId, accountId), eq(customDomains.status, "active")));
  return domain?.hostname ?? fallback;
}

async function insertWithUniqueSlug(db: Db, values: Omit<typeof links.$inferInsert, "slug">) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const [row] = await db
      .insert(links)
      .values({ ...values, slug: newSlug() })
      .onConflictDoNothing()
      .returning();
    if (row) return row;
    // A conflict on reply_id means another worker minted it first.
    if (values.replyId) {
      const [existing] = await db.select().from(links).where(eq(links.replyId, values.replyId));
      if (existing) return existing;
    }
  }
  throw new Error("could not allocate a link slug");
}

// The tracked link for one reply. Minted when the reply is first shown or
// sent; until it is posted, host, campaign and destination follow the reply
// (a switched keyword, a domain that just went live). After posting it is
// frozen (R-07). Returns null when no link host exists: the reply then
// carries the destination URL as before Phase 5.
export async function ensureReplyLink(
  db: Db,
  replyId: string,
  options: { fallbackHost: string | null },
  now = new Date(),
): Promise<{ id: string; url: string } | null> {
  const [row] = await db
    .select({ reply: replies, campaign: campaigns })
    .from(replies)
    .leftJoin(campaigns, eq(campaigns.id, replies.campaignId))
    .where(eq(replies.id, replyId));
  if (!row) return null;
  const { reply, campaign } = row;
  const [existing] = reply.linkId ? await db.select().from(links).where(eq(links.id, reply.linkId)) : [];
  if (existing?.publishedAt) return { id: existing.id, url: linkUrl(existing.host, existing.slug) };

  const host = await linkHostFor(db, reply.accountId, options.fallbackHost);
  if (!host || !campaign) return existing ? { id: existing.id, url: linkUrl(existing.host, existing.slug) } : null;
  const fields = {
    host,
    campaignId: campaign.id,
    youtubeVideoId: reply.youtubeVideoId,
    keyword: reply.keyword,
    intent: reply.intent,
    destinationUrl: campaign.destinationUrl,
    updatedAt: now,
  };
  if (existing) {
    await db.update(links).set(fields).where(eq(links.id, existing.id));
    return { id: existing.id, url: linkUrl(host, existing.slug) };
  }
  const link = await insertWithUniqueSlug(db, { ...fields, accountId: reply.accountId, kind: "reply", replyId: reply.id });
  await db.update(replies).set({ linkId: link.id }).where(and(eq(replies.id, reply.id), isNull(replies.linkId)));
  return { id: link.id, url: linkUrl(link.host, link.slug) };
}

// Called once the reply is on YouTube (API or by hand): the link is frozen.
export async function publishLink(db: Db, linkId: string, now = new Date()): Promise<void> {
  await db.update(links).set({ publishedAt: now, updatedAt: now }).where(and(eq(links.id, linkId), isNull(links.publishedAt)));
}

// A reusable link per campaign and video (or channel-wide) for descriptions
// and pinned comments (R-07 "static"). Published at once.
export async function ensureStaticLink(
  db: Db,
  input: { accountId: string; campaignId: string; youtubeVideoId: string | null; fallbackHost: string | null },
  now = new Date(),
): Promise<{ id: string; url: string } | null> {
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.id, input.campaignId), eq(campaigns.accountId, input.accountId)));
  if (!campaign) return null;
  const videoMatch = input.youtubeVideoId ? eq(links.youtubeVideoId, input.youtubeVideoId) : isNull(links.youtubeVideoId);
  const [existing] = await db
    .select()
    .from(links)
    .where(and(eq(links.kind, "static"), eq(links.campaignId, campaign.id), videoMatch));
  if (existing) return { id: existing.id, url: linkUrl(existing.host, existing.slug) };
  const host = await linkHostFor(db, input.accountId, input.fallbackHost);
  if (!host) return null;
  const link = await insertWithUniqueSlug(db, {
    accountId: input.accountId,
    kind: "static",
    host,
    campaignId: campaign.id,
    youtubeVideoId: input.youtubeVideoId,
    keyword: campaign.keyword,
    intent: campaign.intent,
    destinationUrl: campaign.destinationUrl,
    publishedAt: now,
  });
  return { id: link.id, url: linkUrl(link.host, link.slug) };
}

export interface ClickInput {
  slug: string;
  host: string;
  ip: string | null;
  userAgent: string | null;
  country: string | null;
  referer: string | null;
  ipSecret: string;
  fallbackHost: string | null;
}

// Set for a measured, non-bot click: the route emits the link_clicked event
// after the redirect is on its way, so webhooks never slow a click down.
export interface ClickedEvent {
  accountId: string;
  occurredAt: Date;
  context: EventContext;
}

export type ClickResult =
  | { kind: "redirect"; location: string; setCookie: string | null; clicked: ClickedEvent | null }
  | { kind: "not_found" }
  | { kind: "blocked" };

function refererHost(referer: string | null): string | null {
  if (!referer) return null;
  try {
    return new URL(referer).hostname.slice(0, 200);
  } catch {
    return null;
  }
}

// Resolves a click on any link host (SPEC section 8). Always redirects to the
// configured destination (no open redirect, R-20). Suspended accounts keep
// redirecting but are not measured (R-35). Bots are logged but get no tid.
export async function resolveClick(db: Db, input: ClickInput, now = new Date()): Promise<ClickResult> {
  if (!isSlug(input.slug)) return { kind: "not_found" };
  const [row] = await db
    .select({ link: links, account: accounts, campaign: campaigns })
    .from(links)
    .innerJoin(accounts, eq(accounts.id, links.accountId))
    .leftJoin(campaigns, eq(campaigns.id, links.campaignId))
    .where(eq(links.slug, input.slug));
  if (!row) return { kind: "not_found" };
  const { link, account, campaign } = row;
  if (account.fallbackLinksBlocked && input.host === input.fallbackHost) return { kind: "blocked" };

  // Unpublished reply links follow the campaign; published ones use their snapshot.
  const destination = !link.publishedAt && campaign ? campaign.destinationUrl : link.destinationUrl;
  const uaClass = classifyUserAgent(input.userAgent);
  const isBot = uaClass === "bot";
  const measured = account.status === "active";
  const tid = measured && !isBot ? newTid() : null;

  if (measured) {
    await db
      .insert(clicks)
      .values({
        tid: tid ?? `bot_${newTid()}`,
        accountId: account.id,
        linkId: link.id,
        replyId: link.replyId,
        campaignId: link.campaignId,
        youtubeVideoId: link.youtubeVideoId,
        keyword: link.keyword,
        host: input.host,
        ipHash: hashIp(input.ip, input.ipSecret, pacificDate(now)),
        userAgent: input.userAgent?.slice(0, 400) ?? null,
        userAgentClass: uaClass,
        isBot,
        country: input.country?.slice(0, 2) ?? null,
        referrerHost: refererHost(input.referer),
        createdAt: now,
      });
  }
  // The first-party cookie only makes sense on the creator's own domain.
  const ownDomain = input.host !== input.fallbackHost;
  return {
    kind: "redirect",
    location: destinationWithTid(destination, { tid, keyword: link.keyword }),
    setCookie: tid && ownDomain ? tidCookie(tid, input.host) : null,
    clicked: tid
      ? {
          accountId: account.id,
          occurredAt: now,
          context: {
            channelId: campaign?.channelId ?? null,
            videoId: link.youtubeVideoId,
            campaignId: link.campaignId,
            campaign: campaign?.name ?? null,
            keyword: link.keyword,
            intent: link.intent,
            replyId: link.replyId,
            tid,
          },
        }
      : null,
  };
}

// Live link hosts the router accepts besides the app host.
export async function isKnownLinkHost(db: Db, host: string, fallback: string | null): Promise<boolean> {
  if (host === fallback) return true;
  const [row] = await db
    .select({ id: customDomains.id })
    .from(customDomains)
    .where(and(eq(customDomains.hostname, host), ne(customDomains.status, "removed")));
  return Boolean(row);
}
