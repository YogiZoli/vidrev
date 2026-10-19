import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import type { Db } from "@/db/client";
import { accounts, campaigns, clicks, customDomains, links, replies } from "@/db/schema";
import {
  classifyUserAgent,
  destinationWithTid,
  hashIp,
  hostOf,
  isSlug,
  newSlug,
  newTid,
  publicLinkUrl,
  tidCookie,
} from "@/lib/links";
import { pacificDate } from "@/lib/time";
import type { EventContext } from "@/lib/webhooks";

// Tracked links on the creator's own domain (D-33, D-38), fallback host for
// creators without a domain.

// The host new links are published on: the account's active custom domain,
// else the fallback host, else null (no link host configured yet).
export async function linkHostFor(db: Db, accountId: string, fallback: string | null): Promise<string | null> {
  return (await ownLinkHost(db, accountId)) ?? fallback;
}

// The account's live link domain, or null.
export async function ownLinkHost(db: Db, accountId: string): Promise<string | null> {
  const [domain] = await db
    .select({ hostname: customDomains.hostname })
    .from(customDomains)
    .where(and(eq(customDomains.accountId, accountId), eq(customDomains.status, "active")));
  return domain?.hostname ?? null;
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
): Promise<{ id: string; url: string; slug: string } | null> {
  const [row] = await db
    .select({ reply: replies, campaign: campaigns })
    .from(replies)
    .leftJoin(campaigns, eq(campaigns.id, replies.campaignId))
    .where(eq(replies.id, replyId));
  if (!row) return null;
  const { reply, campaign } = row;
  const [existing] = reply.linkId ? await db.select().from(links).where(eq(links.id, reply.linkId)) : [];
  if (existing?.publishedAt) return { id: existing.id, slug: existing.slug, url: publicLinkUrl(existing) };

  if (!campaign) return existing ? { id: existing.id, slug: existing.slug, url: publicLinkUrl(existing) } : null;
  const own = await ownLinkHost(db, reply.accountId);
  const host = own ?? options.fallbackHost ?? hostOf(campaign.destinationUrl);
  if (!host) return existing ? { id: existing.id, slug: existing.slug, url: publicLinkUrl(existing) } : null;
  const fields = {
    host,
    // No live link domain: the reply carries the creator's own page (A-38).
    directTid: own ? null : (existing?.directTid ?? newTid()),
    campaignId: campaign.id,
    youtubeVideoId: reply.youtubeVideoId,
    keyword: reply.keyword,
    intent: reply.intent,
    destinationUrl: campaign.destinationUrl,
    updatedAt: now,
  };
  if (existing) {
    await db.update(links).set(fields).where(eq(links.id, existing.id));
    return { id: existing.id, slug: existing.slug, url: publicLinkUrl({ ...fields, slug: existing.slug }) };
  }
  const link = await insertWithUniqueSlug(db, { ...fields, accountId: reply.accountId, kind: "reply", replyId: reply.id });
  await db.update(replies).set({ linkId: link.id }).where(and(eq(replies.id, reply.id), isNull(replies.linkId)));
  return { id: link.id, slug: link.slug, url: publicLinkUrl(link) };
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
): Promise<{ id: string; url: string; slug: string } | null> {
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
  const own = await ownLinkHost(db, input.accountId);
  if (existing) {
    // A static link minted on the fallback host before A-38 is shown as the
    // creator's own page from now on; its short link keeps redirecting.
    if (!own && !existing.directTid && existing.host === input.fallbackHost) {
      const directTid = newTid();
      await db.update(links).set({ directTid, updatedAt: now }).where(eq(links.id, existing.id));
      return { id: existing.id, slug: existing.slug, url: publicLinkUrl({ ...existing, directTid }) };
    }
    return { id: existing.id, slug: existing.slug, url: publicLinkUrl(existing) };
  }
  const host = own ?? input.fallbackHost ?? hostOf(campaign.destinationUrl);
  if (!host) return null;
  const link = await insertWithUniqueSlug(db, {
    accountId: input.accountId,
    kind: "static",
    host,
    directTid: own ? null : newTid(),
    campaignId: campaign.id,
    youtubeVideoId: input.youtubeVideoId,
    keyword: campaign.keyword,
    intent: campaign.intent,
    destinationUrl: campaign.destinationUrl,
    publishedAt: now,
  });
  return { id: link.id, slug: link.slug, url: publicLinkUrl(link) };
}

// A direct link's tracking id has no redirect to log a click. The click is
// recorded the first time the id comes back: the opt-in page beacon
// (/vidrev.js), an opt-in, a purchase. Afterwards every lookup by tid works
// exactly as for redirect clicks. Returns how many clicks were recorded.
export async function claimDirectTids(
  db: Db,
  accountId: string | null,
  tids: readonly string[],
  input: { userAgent?: string | null; referer?: string | null; country?: string | null } = {},
  now = new Date(),
): Promise<number> {
  const wanted = [...new Set(tids.filter((t) => /^[A-Za-z0-9]{10}$/.test(t)))];
  if (!wanted.length) return 0;
  const uaClass = classifyUserAgent(input.userAgent ?? null);
  if (uaClass === "bot") return 0;
  const match = inArray(links.directTid, wanted);
  const rows = await db
    .select({ link: links, contactId: replies.contactId, status: accounts.status })
    .from(links)
    .innerJoin(accounts, eq(accounts.id, links.accountId))
    .leftJoin(replies, eq(replies.id, links.replyId))
    .where(accountId ? and(match, eq(links.accountId, accountId)) : match);
  const measured = rows.filter((r) => r.status === "active" && r.link.directTid);
  if (!measured.length) return 0;
  const inserted = await db
    .insert(clicks)
    .values(
      measured.map(({ link, contactId }) => ({
        tid: link.directTid!,
        accountId: link.accountId,
        linkId: link.id,
        replyId: link.replyId,
        contactId: contactId ?? null,
        campaignId: link.campaignId,
        youtubeVideoId: link.youtubeVideoId,
        keyword: link.keyword,
        host: hostOf(link.destinationUrl) ?? link.host,
        userAgent: input.userAgent?.slice(0, 400) ?? null,
        userAgentClass: uaClass,
        isBot: false,
        country: input.country?.slice(0, 2) ?? null,
        referrerHost: refererHost(input.referer ?? null),
        createdAt: now,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: clicks.id });
  return inserted.length;
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
    .select({ link: links, account: accounts, campaign: campaigns, contactId: replies.contactId })
    .from(links)
    .innerJoin(accounts, eq(accounts.id, links.accountId))
    .leftJoin(campaigns, eq(campaigns.id, links.campaignId))
    .leftJoin(replies, eq(replies.id, links.replyId))
    .where(eq(links.slug, input.slug));
  if (!row) return { kind: "not_found" };
  const { link, account, campaign } = row;
  // The person the reply was written to (section 13); a static link has none
  // until an opt-in carrying its tracking id ties one.
  const contactId = row.contactId ?? null;
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
        contactId,
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
            contactId,
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
