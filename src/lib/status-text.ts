// Creator-facing texts for status codes, in one place: Google connect errors
// (the `error` query after OAuth), channel status reasons and reply reasons.

export const CHANNEL_CONNECT_ERRORS: Record<string, string> = {
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

export const CHANNEL_REASONS: Record<string, string> = {
  no_channel: "This Google account has no channel. Connect the Google account that owns your channel.",
  connected_to_another_account: "This channel is already connected to another account.",
  account_suspended: "Your account is suspended.",
  access_revoked: "Access was revoked in your Google account. Connect again.",
  connect_timeout: "Connecting took too long and was stopped. Connect again.",
};

export const REPLY_REASONS: Record<string, string> = {
  monthly_cap: "monthly plan limit reached",
  daily_quota: "YouTube's daily limit",
  comment_gone: "the comment was deleted",
  campaign_deleted: "the campaign was deleted",
  channel_revoked: "channel access was revoked",
  channel_not_connected: "channel not connected",
  commentsDisabled: "comments are turned off on this video",
  forbidden: "YouTube refused the reply",
  send_unconfirmed: "YouTube did not confirm the reply; check the video and post it yourself if it is missing",
};
