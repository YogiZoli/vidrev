import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

// One row per worker role; the worker upserts it every minute and the
// health endpoint reports its age.
export const workerHeartbeats = pgTable("worker_heartbeats", {
  id: text("id").primaryKey(),
  beatAt: timestamp("beat_at", { withTimezone: true }).notNull(),
  version: text("version").notNull(),
});

// Plans are data, never code branches (SPEC section 6). Seeded from
// src/lib/plans.ts; null caps mean "no plan cap".
export const plans = pgTable("plans", {
  code: text("code").primaryKey(),
  label: text("label").notNull(),
  billing: text("billing").notNull(),
  priceLabel: text("price_label"),
  channelLimit: integer("channel_limit").notNull(),
  monthlyReplyCap: integer("monthly_reply_cap"),
  dailyReplyCap: integer("daily_reply_cap"),
  seatsCap: integer("seats_cap"),
  features: jsonb("features").$type<Record<string, unknown>>().notNull().default({}),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

export type AccountStatus = "active" | "suspended";
export type AiProvider = "platform" | "gemini" | "openai" | "anthropic";

export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name"),
  status: text("status").$type<AccountStatus>().notNull().default("active"),
  planCode: text("plan_code")
    .notNull()
    .references(() => plans.code),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  // Subscription id from the checkout that activated the account; guards
  // against an old subscription's cancellation suspending a newer one.
  billingRef: text("billing_ref"),
  suspendedAt: timestamp("suspended_at", { withTimezone: true }),
  reportingCurrency: text("reporting_currency").notNull().default("USD"),
  // AI drafting (DECISIONS Q-13c): "platform" uses the owner's billing-enabled
  // Gemini key; otherwise the account's own key, encrypted at rest.
  aiProvider: text("ai_provider").$type<AiProvider>().notNull().default("platform"),
  aiKeyEnc: text("ai_key_enc"),
  aiModel: text("ai_model"),
  // Last "drafts are waiting" email, so the notification is throttled.
  draftsNotifiedAt: timestamp("drafts_notified_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// One user per account for the MVP (SPEC-REVIEW R-06).
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    name: text("name"),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("users_email_uq").on(t.email), index("users_account_idx").on(t.accountId)],
);

// Only token hashes are stored; the token itself exists only in the cookie.
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("sessions_token_hash_uq").on(t.tokenHash), index("sessions_user_idx").on(t.userId)],
);

// Single use, 15 minutes, stored hashed.
export const magicLinkTokens = pgTable(
  "magic_link_tokens",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("magic_link_tokens_user_idx").on(t.userId, t.createdAt)],
);

// Idempotency on (source, event, external_id): the same subscription id
// arrives with both purchase and subscription_cancelled (SPEC-REVIEW R-05).
export const provisioningEvents = pgTable(
  "provisioning_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: text("source").notNull(),
    event: text("event").notNull(),
    externalId: text("external_id").notNull(),
    payload: jsonb("payload").notNull(),
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
    result: text("result").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("provisioning_events_uq").on(t.source, t.event, t.externalId)],
);

export type ChannelStatus = "connecting" | "connected" | "disconnecting" | "disconnected" | "revoked" | "rejected";

// A connected YouTube channel. Tokens are encrypted (crypto.ts). `title` is
// YouTube API data and falls under the 30-day rule (DECISIONS Q-17 c).
export const channels = pgTable(
  "channels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    youtubeChannelId: text("youtube_channel_id"),
    title: text("title"),
    titleRefreshedAt: timestamp("title_refreshed_at", { withTimezone: true }),
    defaultLanguage: text("default_language").notNull().default("en"),
    refreshTokenEnc: text("refresh_token_enc"),
    accessTokenEnc: text("access_token_enc"),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    scopes: text("scopes"),
    status: text("status").$type<ChannelStatus>().notNull(),
    statusReason: text("status_reason"),
    connectedAt: timestamp("connected_at", { withTimezone: true }),
    disconnectedAt: timestamp("disconnected_at", { withTimezone: true }),
    // Polling state (SPEC section 7). `commentCursor` is the publish time of
    // the newest comment already processed; older comments are never drafted.
    nextPollAt: timestamp("next_poll_at", { withTimezone: true }),
    lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
    commentCursor: timestamp("comment_cursor", { withTimezone: true }),
    // Fast polling window after a new upload (PubSubHubbub or RSS).
    freshUntil: timestamp("fresh_until", { withTimezone: true }),
    lastUploadAt: timestamp("last_upload_at", { withTimezone: true }),
    websubExpiresAt: timestamp("websub_expires_at", { withTimezone: true }),
    rssCheckedAt: timestamp("rss_checked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("channels_account_idx").on(t.accountId),
    index("channels_next_poll_idx").on(t.nextPollAt),
    // A YouTube channel can be live in only one account at a time.
    uniqueIndex("channels_youtube_live_uq")
      .on(t.youtubeChannelId)
      .where(sql`status in ('connecting', 'connected')`),
  ],
);

// Every YouTube API call writes a row (SPEC section 7). `gcp_project` is
// "app" for the shared product project; Phase 4 adds the budget on top.
export const quotaLedger = pgTable(
  "quota_ledger",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    gcpProject: text("gcp_project").notNull(),
    datePt: date("date_pt").notNull(),
    method: text("method").notNull(),
    units: integer("units").notNull(),
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("quota_ledger_day_idx").on(t.gcpProject, t.datePt)],
);

// Admin actions, plan changes and owner alerts.
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    actor: text("actor").notNull(),
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("audit_log_account_idx").on(t.accountId), index("audit_log_action_idx").on(t.action)],
);

// Global settings stored as data (DECISIONS Q-02: the reply reserve is data,
// default 75 percent). Seeded once; later edits in the database win.
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// YouTube API data: the title falls under the 30-day rule (Q-17 c).
export const videos = pgTable(
  "videos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    youtubeVideoId: text("youtube_video_id").notNull(),
    title: text("title"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("videos_channel_video_uq").on(t.channelId, t.youtubeVideoId)],
);

export type Intent = "hot" | "warm" | "cold";

// A watched keyword on one channel (Q-10, Q-10b). `videoIds` null means
// channel-wide; otherwise only comments on those videos match.
export const campaigns = pgTable(
  "campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    keyword: text("keyword").notNull(),
    aliases: text("aliases").array().notNull().default(sql`'{}'::text[]`),
    intent: text("intent").$type<Intent>().notNull().default("warm"),
    destinationUrl: text("destination_url").notNull(),
    videoIds: text("video_ids").array(),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("campaigns_channel_idx").on(t.channelId), index("campaigns_account_idx").on(t.accountId)],
);

// Creator-written reply templates. Saving a template is the creator's
// approval (B-06): only these languages are ever used for replies.
export const templates = pgTable(
  "templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    language: text("language").notNull(),
    body: text("body").notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [index("templates_campaign_idx").on(t.campaignId, t.language)],
);

// A top-level keyword comment (Q-19). YouTube API data: deleted after 30 days
// by the retention job (Q-17 c). Only matching comments are stored.
export const comments = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    youtubeCommentId: text("youtube_comment_id").notNull(),
    youtubeVideoId: text("youtube_video_id").notNull(),
    authorChannelId: text("author_channel_id"),
    authorName: text("author_name"),
    text: text("text").notNull(),
    language: text("language"),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("comments_youtube_uq").on(t.youtubeCommentId), index("comments_fetched_idx").on(t.fetchedAt)],
);

export type ReplyStatus =
  | "pending_approval"
  | "approved"
  | "queued"
  | "sending"
  | "sent"
  | "sent_manually"
  | "failed"
  | "skipped"
  | "dismissed"
  | "expired";

export interface MatchedKeyword {
  campaignId: string;
  keyword: string;
  intent: Intent;
}

// A draft and, once approved, the reply we send. First-party data (Q-17 c),
// except `youtubeReplyId`, which the retention job wipes after 30 days.
// `body` keeps the {link} placeholder; the link is filled in at send time.
export const replies = pgTable(
  "replies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    commentId: uuid("comment_id").references(() => comments.id, { onDelete: "set null" }),
    campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
    templateId: uuid("template_id").references(() => templates.id, { onDelete: "set null" }),
    youtubeVideoId: text("youtube_video_id").notNull(),
    keyword: text("keyword").notNull(),
    intent: text("intent").$type<Intent>().notNull(),
    otherMatches: jsonb("other_matches").$type<MatchedKeyword[]>().notNull().default([]),
    language: text("language").notNull(),
    body: text("body").notNull(),
    draftSource: text("draft_source").$type<"ai" | "template">().notNull(),
    status: text("status").$type<ReplyStatus>().notNull().default("pending_approval"),
    statusReason: text("status_reason"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    // Pacific-time quota day the reply waits for when today's budget is full.
    queuedForDatePt: date("queued_for_date_pt"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    youtubeReplyId: text("youtube_reply_id"),
    attempts: integer("attempts").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("replies_account_status_idx").on(t.accountId, t.status),
    index("replies_status_idx").on(t.status, t.queuedForDatePt),
    uniqueIndex("replies_comment_uq").on(t.commentId),
  ],
);
