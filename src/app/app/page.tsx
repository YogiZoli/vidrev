import { getDb } from "@/db/client";
import { isAdminEmail, requireSession } from "@/server/auth/current";
import { listChannels, LIVE_STATUSES } from "@/server/channels";
import { Notice, productName, styles } from "../ui";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  google_not_configured: "Channel connection is not configured yet.",
  account_suspended: "Your account is suspended. Renew your subscription to connect a channel.",
  channel_limit: "Your plan's channel limit is reached. Disconnect a channel first.",
  google_denied: "The Google permission was not granted.",
  scope_missing: "The comment permission was unticked on the Google screen. Connect again and keep it ticked.",
  no_refresh_token: "Google did not grant offline access. Connect again.",
  oauth_state: "The connection request expired. Try again.",
  oauth_failed: "Connecting failed. Try again.",
  channel_not_found: "That channel was not found.",
};

const REASONS: Record<string, string> = {
  no_channel: "This Google account has no channel. Connect the Google account that owns your channel.",
  connected_to_another_account: "This channel is already connected to another account.",
  account_suspended: "Your account is suspended.",
  access_revoked: "Access was revoked in your Google account. Connect again.",
};

export default async function AppPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { user, account, plan } = await requireSession();
  const params = await searchParams;
  const channelRows = await listChannels(getDb(), account.id);
  const live = channelRows.filter((c) => LIVE_STATUSES.includes(c.status)).length;
  const connecting = channelRows.some((c) => c.status === "connecting" || c.status === "disconnecting");

  return (
    <main style={styles.main}>
      {/* While the worker resolves a channel, refresh every few seconds. */}
      {connecting ? <meta httpEquiv="refresh" content="3" /> : null}
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ margin: 0 }}>{productName()}</h1>
        <form method="post" action="/api/auth/logout">
          <button type="submit" style={styles.secondary}>
            Sign out
          </button>
        </form>
      </header>

      {params.error && ERRORS[params.error] ? <Notice tone="error">{ERRORS[params.error]}</Notice> : null}
      {params.connected ? <Notice tone="info">Google access granted. Finishing the connection.</Notice> : null}
      {params.disconnected ? <Notice tone="info">Channel disconnected. Its YouTube data is being deleted.</Notice> : null}
      {account.status === "suspended" ? (
        <Notice tone="error">Your account is suspended. Nothing is polled or sent. Your reports are kept.</Notice>
      ) : null}

      <section style={styles.card}>
        <h2 style={{ marginTop: 0 }}>Account</h2>
        <p>
          {user.email}
          <br />
          Plan: {plan.label}
          {plan.priceLabel ? ` (${plan.priceLabel})` : ""}
          {account.trialEndsAt ? `, trial ends ${account.trialEndsAt.toISOString().slice(0, 10)}` : ""}
        </p>
        <p style={styles.muted}>
          Replies: {plan.monthlyReplyCap ?? "no plan limit"} per month, at most {plan.dailyReplyCap ?? "unlimited"} per day.
        </p>
        {isAdminEmail(user.email) ? (
          <p>
            <a href="/admin">Owner admin</a>
          </p>
        ) : null}
      </section>

      <section style={styles.card}>
        <h2 style={{ marginTop: 0 }}>Channel</h2>
        {channelRows.length === 0 ? <p style={styles.muted}>No channel connected yet.</p> : null}
        {channelRows.map((channel) => (
          <div key={channel.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "8px 0" }}>
            <div>
              <strong>{channel.title ?? (channel.status === "connecting" ? "Connecting..." : "Channel")}</strong>
              <br />
              <span style={styles.muted}>
                {channel.status}
                {channel.statusReason && REASONS[channel.statusReason] ? `: ${REASONS[channel.statusReason]}` : ""}
              </span>
            </div>
            {channel.status !== "disconnecting" && channel.status !== "connecting" ? (
              <form method="post" action="/api/channels/disconnect">
                <input type="hidden" name="channelId" value={channel.id} />
                <button type="submit" style={styles.secondary}>
                  {channel.status === "connected" ? "Disconnect" : "Remove"}
                </button>
              </form>
            ) : null}
          </div>
        ))}
        {live < plan.channelLimit && account.status === "active" ? (
          <p>
            <a href="/api/oauth/google/start" style={{ ...styles.button, display: "inline-block", textDecoration: "none" }}>
              Connect your channel
            </a>
          </p>
        ) : null}
        {live > 0 ? (
          <p>
            <a href="/app/queue">Approval queue</a> · <a href="/app/campaigns">Keywords and replies</a>
          </p>
        ) : null}
        <p style={styles.muted}>
          We ask Google only for permission to read comments and post the replies you approve. Every reply waits for your approval.
        </p>
      </section>
    </main>
  );
}
