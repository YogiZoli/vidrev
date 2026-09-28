import { and, eq, inArray, lt, ne } from "drizzle-orm";
import type { Db } from "@/db/client";
import { accounts, channels, comments, contactIdentities, replies, videos } from "@/db/schema";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { errorFields, log } from "@/lib/log";
import { recordQuota } from "@/server/channels";
import { type FetchLike, type GoogleClient, GoogleOAuthError, refreshAccessToken, revokeToken } from "@/server/google/oauth";

export interface ChannelDeps {
  db: Db;
  fetch: FetchLike;
  encryptionKey: string;
  google: Omit<GoogleClient, "redirectUri">;
  now?: () => Date;
}

type ChannelRow = typeof channels.$inferSelect;

// Everything the channel stores from YouTube or Google is wiped when it is
// disconnected, revoked or rejected (DECISIONS Q-17 c).
const WIPED = {
  refreshTokenEnc: null,
  accessTokenEnc: null,
  tokenExpiresAt: null,
  title: null,
  titleRefreshedAt: null,
} as const;

// Comments, video titles and reply ids of a channel that is no longer
// connected are deleted at once (Q-17 c: within 7 days).
async function wipeYoutubeData(db: Db, channelId: string): Promise<void> {
  await db.delete(comments).where(eq(comments.channelId, channelId));
  await db.delete(videos).where(eq(videos.channelId, channelId));
  await db.update(replies).set({ youtubeReplyId: null }).where(eq(replies.channelId, channelId));
  // Commenter channel ids and comment ids that recognise a returning commenter
  // are YouTube data too (DECISIONS 13.9). Contacts and their history stay.
  await db.delete(contactIdentities).where(and(eq(contactIdentities.channelId, channelId), inArray(contactIdentities.kind, ["youtube_channel", "comment"])));
}

export class ChannelRevokedError extends Error {
  constructor() {
    super("Google grant was revoked");
    this.name = "ChannelRevokedError";
  }
}

// Returns a valid access token, refreshing it when it expires within a
// minute. A revoked grant marks the channel "revoked" and wipes its tokens.
export async function getAccessToken(deps: ChannelDeps, channel: ChannelRow): Promise<string> {
  const now = deps.now?.() ?? new Date();
  if (channel.accessTokenEnc && channel.tokenExpiresAt && channel.tokenExpiresAt.getTime() - now.getTime() > 60_000) {
    return decryptSecret(channel.accessTokenEnc, deps.encryptionKey);
  }
  if (!channel.refreshTokenEnc) throw new ChannelRevokedError();
  try {
    const refreshed = await refreshAccessToken(deps.google, decryptSecret(channel.refreshTokenEnc, deps.encryptionKey), deps.fetch);
    await deps.db
      .update(channels)
      .set({
        accessTokenEnc: encryptSecret(refreshed.access_token, deps.encryptionKey),
        tokenExpiresAt: new Date(now.getTime() + refreshed.expires_in * 1000),
      })
      .where(eq(channels.id, channel.id));
    return refreshed.access_token;
  } catch (error) {
    if (error instanceof GoogleOAuthError && error.code === "invalid_grant") {
      await deps.db
        .update(channels)
        .set({ ...WIPED, status: "revoked", statusReason: "access_revoked", disconnectedAt: now })
        .where(eq(channels.id, channel.id));
      await wipeYoutubeData(deps.db, channel.id);
      log("warn", "channel grant revoked", { channelId: channel.id });
      throw new ChannelRevokedError();
    }
    throw error;
  }
}

interface ChannelsListResponse {
  items?: { id: string; snippet?: { title?: string } }[];
}

// Resolves which YouTube channel a fresh grant belongs to (channels.list
// mine=true, 1 unit) and activates it, or rejects it with a reason.
export async function syncChannel(deps: ChannelDeps, channelId: string): Promise<void> {
  const now = deps.now?.() ?? new Date();
  const [channel] = await deps.db.select().from(channels).where(eq(channels.id, channelId)).limit(1);
  if (!channel || channel.status !== "connecting") return;

  let accessToken: string;
  try {
    accessToken = await getAccessToken(deps, channel);
  } catch (error) {
    if (error instanceof ChannelRevokedError) return;
    throw error;
  }

  const response = await deps.fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  await recordQuota(deps.db, { gcpProject: "app", method: "channels.list", units: 1, accountId: channel.accountId }, now);
  if (!response.ok) throw new Error(`channels.list failed with HTTP ${response.status}`);
  const item = ((await response.json()) as ChannelsListResponse).items?.[0];

  if (!item) return reject(deps, channel, "no_channel");

  const [account] = await deps.db.select({ status: accounts.status }).from(accounts).where(eq(accounts.id, channel.accountId));
  if (account?.status !== "active") return reject(deps, channel, "account_suspended");

  const [takenElsewhere] = await deps.db
    .select({ id: channels.id })
    .from(channels)
    .where(
      and(
        eq(channels.youtubeChannelId, item.id),
        inArray(channels.status, ["connecting", "connected"]),
        ne(channels.accountId, channel.accountId),
      ),
    )
    .limit(1);
  if (takenElsewhere) return reject(deps, channel, "connected_to_another_account");

  await deps.db.transaction(async (tx) => {
    // Reconnecting the same channel replaces the old grant in place.
    const previous = await tx
      .update(channels)
      .set({ ...WIPED, status: "disconnected", statusReason: "replaced_by_reconnect", disconnectedAt: now })
      .where(
        and(
          eq(channels.accountId, channel.accountId),
          eq(channels.youtubeChannelId, item.id),
          ne(channels.id, channel.id),
          inArray(channels.status, ["connected", "revoked", "rejected"]),
        ),
      )
      .returning({ id: channels.id });
    await tx
      .update(channels)
      .set({
        youtubeChannelId: item.id,
        title: item.snippet?.title ?? null,
        titleRefreshedAt: now,
        status: "connected",
        statusReason: null,
        connectedAt: now,
      })
      .where(eq(channels.id, channel.id));
    log("info", "channel connected", { channelId: channel.id, replaced: previous.length });
  });
}

async function reject(deps: ChannelDeps, channel: ChannelRow, reason: string): Promise<void> {
  await revokeGrant(deps, channel);
  await deps.db
    .update(channels)
    .set({ ...WIPED, status: "rejected", statusReason: reason, disconnectedAt: deps.now?.() ?? new Date() })
    .where(eq(channels.id, channel.id));
  log("info", "channel rejected", { channelId: channel.id, reason });
}

async function revokeGrant(deps: ChannelDeps, channel: ChannelRow): Promise<void> {
  const encrypted = channel.refreshTokenEnc ?? channel.accessTokenEnc;
  if (!encrypted) return;
  await revokeToken(decryptSecret(encrypted, deps.encryptionKey), deps.fetch);
}

// Revokes the Google grant, then deletes the channel's YouTube data.
export async function disconnectChannel(deps: ChannelDeps, channelId: string): Promise<void> {
  const [channel] = await deps.db.select().from(channels).where(eq(channels.id, channelId)).limit(1);
  if (!channel || channel.status !== "disconnecting") return;
  await revokeGrant(deps, channel);
  await deps.db
    .update(channels)
    .set({ ...WIPED, status: "disconnected", statusReason: "disconnected_by_user", disconnectedAt: deps.now?.() ?? new Date() })
    .where(eq(channels.id, channel.id));
  await wipeYoutubeData(deps.db, channel.id);
  log("info", "channel disconnected", { channelId });
}

// A grant that never finished connecting (channel.sync failed on every retry,
// or the job was lost) would keep the creator on "Finishing the connection"
// for ever, and onboarding locked. After 30 minutes it is rejected with
// "connect_timeout", so the creator sees why and connects again.
export const CONNECT_TIMEOUT_MS = 30 * 60_000;

export async function expireStuckConnects(deps: ChannelDeps): Promise<number> {
  const now = deps.now?.() ?? new Date();
  const stuck = await deps.db
    .select()
    .from(channels)
    .where(and(eq(channels.status, "connecting"), lt(channels.createdAt, new Date(now.getTime() - CONNECT_TIMEOUT_MS))));
  for (const channel of stuck) {
    try {
      log("error", "channel connect timed out", { channelId: channel.id, accountId: channel.accountId, createdAt: channel.createdAt.toISOString() });
      await reject(deps, channel, "connect_timeout");
    } catch (error) {
      log("error", "channel connect timeout handling failed", { channelId: channel.id, ...errorFields(error) });
    }
  }
  return stuck.length;
}
