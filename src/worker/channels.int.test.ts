import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/db/client";
import { channels, quotaLedger } from "@/db/schema";
import { decryptSecret } from "@/lib/crypto";
import { runMigrations } from "@/scripts/migrate";
import { createAccountWithUser } from "@/server/accounts";
import { countLiveChannels, createConnectingChannel, markDisconnecting } from "@/server/channels";
import { type ChannelDeps, disconnectChannel, syncChannel } from "./channels";

// Runs only where a real Postgres is available (CI service container).
const hasDb = Boolean(process.env.DATABASE_URL);
const key = randomBytes(32).toString("base64");

interface Call {
  url: string;
  body?: string;
}

// Fake Google: channels.list returns `youtubeChannelId` (or nothing), token
// refresh answers with `refresh`, revocation always succeeds.
function fakeGoogle(opts: { youtubeChannelId: string | null; refresh?: { status: number; body: unknown } }) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? String(init.body) : undefined });
    if (url.startsWith("https://www.googleapis.com/youtube/v3/channels")) {
      const items = opts.youtubeChannelId ? [{ id: opts.youtubeChannelId, snippet: { title: "My Channel" } }] : [];
      return Response.json({ items });
    }
    if (url === "https://oauth2.googleapis.com/token") {
      const r = opts.refresh ?? { status: 200, body: { access_token: "fresh", expires_in: 3600, scope: "", token_type: "Bearer" } };
      return Response.json(r.body, { status: r.status });
    }
    if (url === "https://oauth2.googleapis.com/revoke") return new Response(null, { status: 200 });
    return new Response("not found", { status: 404 });
  };
  return { calls, fetchImpl };
}

function deps(fetchImpl: ChannelDeps["fetch"]): ChannelDeps {
  return { db: getDb(), fetch: fetchImpl, encryptionKey: key, google: { clientId: "cid", clientSecret: "cs" } };
}

async function connecting(accountId: string, expiresInSeconds = 3600) {
  return createConnectingChannel(
    getDb(),
    { accountId, refreshToken: "refresh-1", accessToken: "access-1", expiresInSeconds, scopes: "openid" },
    key,
  );
}

async function newAccount() {
  return (await createAccountWithUser(getDb(), { email: `ch-${randomUUID()}@example.com`, planCode: "standard_monthly" })).account;
}

async function channelRow(id: string) {
  const [row] = await getDb().select().from(channels).where(eq(channels.id, id));
  return row!;
}

describe.skipIf(!hasDb)("channel connection (integration)", () => {
  beforeAll(async () => {
    await runMigrations(process.env.DATABASE_URL!);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("stores tokens encrypted and connects the channel, recording 1 quota unit", async () => {
    const account = await newAccount();
    const id = await connecting(account.id);
    const stored = await channelRow(id);
    expect(stored.refreshTokenEnc).not.toContain("refresh-1");
    expect(decryptSecret(stored.refreshTokenEnc!, key)).toBe("refresh-1");

    const ytId = `UC${randomUUID()}`;
    const google = fakeGoogle({ youtubeChannelId: ytId });
    await syncChannel(deps(google.fetchImpl), id);

    const row = await channelRow(id);
    expect(row).toMatchObject({ status: "connected", youtubeChannelId: ytId, title: "My Channel" });
    const ledger = await getDb().select().from(quotaLedger).where(eq(quotaLedger.accountId, account.id));
    expect(ledger).toMatchObject([{ gcpProject: "app", method: "channels.list", units: 1 }]);
    expect(await countLiveChannels(getDb(), account.id)).toBe(1);
  });

  it("rejects a channel already live in another account and revokes the grant", async () => {
    const ytId = `UC${randomUUID()}`;
    const first = await connecting((await newAccount()).id);
    await syncChannel(deps(fakeGoogle({ youtubeChannelId: ytId }).fetchImpl), first);

    const second = await connecting((await newAccount()).id);
    const google = fakeGoogle({ youtubeChannelId: ytId });
    await syncChannel(deps(google.fetchImpl), second);

    const row = await channelRow(second);
    expect(row).toMatchObject({ status: "rejected", statusReason: "connected_to_another_account", refreshTokenEnc: null });
    expect(google.calls.some((c) => c.url.endsWith("/revoke"))).toBe(true);
  });

  it("rejects a Google account without a channel", async () => {
    const id = await connecting((await newAccount()).id);
    await syncChannel(deps(fakeGoogle({ youtubeChannelId: null }).fetchImpl), id);
    expect(await channelRow(id)).toMatchObject({ status: "rejected", statusReason: "no_channel" });
  });

  it("replaces the old grant when the same account reconnects the same channel", async () => {
    const account = await newAccount();
    const ytId = `UC${randomUUID()}`;
    const first = await connecting(account.id);
    await syncChannel(deps(fakeGoogle({ youtubeChannelId: ytId }).fetchImpl), first);
    const second = await connecting(account.id);
    await syncChannel(deps(fakeGoogle({ youtubeChannelId: ytId }).fetchImpl), second);

    expect(await channelRow(first)).toMatchObject({ status: "disconnected", statusReason: "replaced_by_reconnect", title: null });
    expect(await channelRow(second)).toMatchObject({ status: "connected" });
  });

  it("marks the channel revoked when Google refuses the refresh token", async () => {
    const id = await connecting((await newAccount()).id, 0);
    const google = fakeGoogle({ youtubeChannelId: "UCx", refresh: { status: 400, body: { error: "invalid_grant" } } });
    await syncChannel(deps(google.fetchImpl), id);
    expect(await channelRow(id)).toMatchObject({ status: "revoked", statusReason: "access_revoked", refreshTokenEnc: null });
  });

  it("disconnects: revokes the grant and wipes tokens and YouTube data", async () => {
    const account = await newAccount();
    const id = await connecting(account.id);
    await syncChannel(deps(fakeGoogle({ youtubeChannelId: `UC${randomUUID()}` }).fetchImpl), id);

    const other = await newAccount();
    expect(await markDisconnecting(getDb(), other.id, id)).toBe(false);
    expect(await markDisconnecting(getDb(), account.id, id)).toBe(true);

    const google = fakeGoogle({ youtubeChannelId: null });
    await disconnectChannel(deps(google.fetchImpl), id);
    const row = await channelRow(id);
    expect(row).toMatchObject({ status: "disconnected", refreshTokenEnc: null, accessTokenEnc: null, title: null });
    expect(new URLSearchParams(google.calls.find((c) => c.url.endsWith("/revoke"))!.body).get("token")).toBe("refresh-1");
    expect(await countLiveChannels(getDb(), account.id)).toBe(0);
  });
});
