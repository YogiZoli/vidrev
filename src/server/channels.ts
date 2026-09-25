import { and, count, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { channels, type ChannelStatus, quotaLedger } from "@/db/schema";
import { encryptSecret } from "@/lib/crypto";
import { pacificDate } from "@/lib/time";
import type { DbOrTx } from "./accounts";

// Channels that occupy a slot of the plan's channel limit.
export const LIVE_STATUSES: ChannelStatus[] = ["connecting", "connected"];

export async function countLiveChannels(db: DbOrTx, accountId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(channels)
    .where(and(eq(channels.accountId, accountId), inArray(channels.status, LIVE_STATUSES)));
  return row?.n ?? 0;
}

export async function listChannels(db: Db, accountId: string) {
  return db
    .select({
      id: channels.id,
      title: channels.title,
      youtubeChannelId: channels.youtubeChannelId,
      status: channels.status,
      statusReason: channels.statusReason,
      defaultLanguage: channels.defaultLanguage,
      connectedAt: channels.connectedAt,
    })
    .from(channels)
    .where(and(eq(channels.accountId, accountId), inArray(channels.status, [...LIVE_STATUSES, "disconnecting", "revoked", "rejected"])))
    .orderBy(desc(channels.createdAt));
}

// Stores the fresh OAuth grant; the worker resolves which YouTube channel it
// belongs to (channel.sync), so the callback never waits on the YouTube API.
export async function createConnectingChannel(
  db: Db,
  input: { accountId: string; refreshToken: string; accessToken: string; expiresInSeconds: number; scopes: string },
  encryptionKey: string,
  now = new Date(),
): Promise<string> {
  const [row] = await db
    .insert(channels)
    .values({
      accountId: input.accountId,
      status: "connecting",
      refreshTokenEnc: encryptSecret(input.refreshToken, encryptionKey),
      accessTokenEnc: encryptSecret(input.accessToken, encryptionKey),
      tokenExpiresAt: new Date(now.getTime() + input.expiresInSeconds * 1000),
      scopes: input.scopes,
    })
    .returning({ id: channels.id });
  return row!.id;
}

// Account-scoped: a user can only disconnect their own channel.
export async function markDisconnecting(db: Db, accountId: string, channelId: string): Promise<boolean> {
  const rows = await db
    .update(channels)
    .set({ status: "disconnecting" })
    .where(and(eq(channels.id, channelId), eq(channels.accountId, accountId), inArray(channels.status, [...LIVE_STATUSES, "revoked", "rejected"])))
    .returning({ id: channels.id });
  return rows.length > 0;
}

export async function recordQuota(
  db: DbOrTx,
  entry: { gcpProject: "app" | "audit"; method: string; units: number; accountId: string | null },
  at = new Date(),
): Promise<void> {
  await db.insert(quotaLedger).values({ ...entry, datePt: pacificDate(at) });
}
