import { sql } from "drizzle-orm";
import {
  bigint,
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
  // Owner kill switch for the shared fallback link host (R-20).
  fallbackLinksBlocked: boolean("fallback_links_blocked").notNull().default(false),
  // Reports (Phase 7): set when new first-party data arrives; the worker
  // recomputes attribution and report snapshots and clears it.
  reportDirtyAt: timestamp("report_dirty_at", { withTimezone: true }),
  reportsComputedAt: timestamp("reports_computed_at", { withTimezone: true }),
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
    // Tracked link minted for this reply (Phase 5).
    linkId: uuid("link_id"),
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

export type CustomDomainStatus = "pending" | "active" | "failed" | "removed";

// The creator's own link host, e.g. go.userdomain.com (D-33, D-38). TLS via
// Cloudflare for SaaS custom hostnames on the owner's zone. Rows are kept
// after removal (first-party history); one live domain per account.
export const customDomains = pgTable(
  "custom_domains",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    hostname: text("hostname").notNull(),
    status: text("status").$type<CustomDomainStatus>().notNull().default("pending"),
    // Cloudflare custom hostname id and its raw statuses.
    cloudflareHostnameId: text("cloudflare_hostname_id"),
    hostnameStatus: text("hostname_status"),
    sslStatus: text("ssl_status"),
    // Our own DNS check: does the CNAME point at CUSTOM_HOSTNAME_CNAME_TARGET?
    dnsOk: boolean("dns_ok").notNull().default(false),
    dnsTarget: text("dns_target"),
    // DNS provider detected by NS lookup (D-38), e.g. "cloudflare", "godaddy".
    dnsProvider: text("dns_provider"),
    nameservers: text("nameservers").array(),
    domainConnect: jsonb("domain_connect").$type<{ providerId: string; urlSyncUX: string } | null>(),
    lastError: text("last_error"),
    checks: integer("checks").notNull().default(0),
    // Start of the current verification attempt ("Check now" restarts it).
    checkStartedAt: timestamp("check_started_at", { withTimezone: true }).notNull().defaultNow(),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("custom_domains_live_host_uq").on(t.hostname).where(sql`status <> 'removed'`),
    uniqueIndex("custom_domains_live_account_uq").on(t.accountId).where(sql`status <> 'removed'`),
  ],
);

export type LinkKind = "reply" | "static";

// A tracked link (SPEC-REVIEW R-07). Slugs are globally unique, so any link
// host resolves them. `host` is the host the link was published on and never
// changes once a reply is posted. `destinationUrl` is a snapshot: links keep
// redirecting after a campaign is deleted or the account cancels (R-35).
export const links = pgTable(
  "links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    kind: text("kind").$type<LinkKind>().notNull(),
    slug: text("slug").notNull(),
    host: text("host").notNull(),
    campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
    replyId: uuid("reply_id"),
    youtubeVideoId: text("youtube_video_id"),
    keyword: text("keyword").notNull(),
    intent: text("intent").$type<Intent>(),
    destinationUrl: text("destination_url").notNull(),
    // Set once the reply carrying the link is posted; host and campaign freeze.
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("links_slug_uq").on(t.slug),
    uniqueIndex("links_reply_uq").on(t.replyId),
    uniqueIndex("links_static_uq").on(t.campaignId, t.youtubeVideoId).where(sql`kind = 'static'`),
    index("links_account_idx").on(t.accountId),
  ],
);

// One row per click, first-party data (DECISIONS section 8). The tid is the
// click id carried to the opt-in page as c2c_tid. Campaign, video and keyword
// are copied from the link so reports survive campaign deletion.
export const clicks = pgTable(
  "clicks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tid: text("tid").notNull(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    linkId: uuid("link_id")
      .notNull()
      .references(() => links.id, { onDelete: "cascade" }),
    replyId: uuid("reply_id"),
    campaignId: uuid("campaign_id"),
    youtubeVideoId: text("youtube_video_id"),
    keyword: text("keyword").notNull(),
    host: text("host").notNull(),
    ipHash: text("ip_hash"),
    userAgent: text("user_agent"),
    userAgentClass: text("user_agent_class").notNull(),
    isBot: boolean("is_bot").notNull(),
    country: text("country"),
    referrerHost: text("referrer_host"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("clicks_tid_uq").on(t.tid),
    index("clicks_account_created_idx").on(t.accountId, t.createdAt),
    index("clicks_link_idx").on(t.linkId),
  ],
);

export type IntegrationType = "outbound_webhook" | "ghl";
export type IntegrationStatus = "active" | "disabled" | "error" | "removed";

// A connected outside system (SPEC section 5). `configEnc` holds the JSON
// config, encrypted (outbound: url and signing secret; ghl: OAuth tokens,
// custom field id, buyer tag). It is wiped when the integration is removed.
// `externalRef` is the GHL location id: one location is live in one account.
export const integrations = pgTable(
  "integrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    type: text("type").$type<IntegrationType>().notNull(),
    label: text("label"),
    configEnc: text("config_enc"),
    status: text("status").$type<IntegrationStatus>().notNull().default("active"),
    statusReason: text("status_reason"),
    // Outbound endpoints: subscribed event names; null means all events.
    events: text("events").array(),
    externalRef: text("external_ref"),
    // GHL sync state: cursors per data kind, next run and last success.
    syncState: jsonb("sync_state").$type<Record<string, unknown>>().notNull().default({}),
    nextSyncAt: timestamp("next_sync_at", { withTimezone: true }),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
  },
  (t) => [
    index("integrations_account_idx").on(t.accountId, t.type),
    index("integrations_next_sync_idx").on(t.nextSyncAt),
    uniqueIndex("integrations_live_ref_uq")
      .on(t.type, t.externalRef)
      .where(sql`status <> 'removed' and external_ref is not null`),
  ],
);

export type DeliveryStatus = "pending" | "delivered" | "dead";

// Outbox for outbound webhooks (SPEC section 11). One row per event and
// endpoint; the worker delivers it and retries with backoff for 24 hours.
// `eventId` is the same for every endpoint and travels as X-Event-Id.
export const outboundDeliveries = pgTable(
  "outbound_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    integrationId: uuid("integration_id")
      .notNull()
      .references(() => integrations.id, { onDelete: "cascade" }),
    eventId: uuid("event_id").notNull(),
    event: text("event").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    attempt: integer("attempt").notNull().default(0),
    status: text("status").$type<DeliveryStatus>().notNull().default("pending"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    responseStatus: integer("response_status"),
    lastError: text("last_error"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("outbound_deliveries_event_uq").on(t.integrationId, t.eventId),
    index("outbound_deliveries_due_idx").on(t.status, t.nextAttemptAt),
    index("outbound_deliveries_integration_idx").on(t.integrationId, t.createdAt),
  ],
);

// Token for the universal inbound hooks (SPEC-REVIEW R-05): only the hash is
// used for lookup; the encrypted token is kept so the creator can see it again.
export const inboundHookSecrets = pgTable(
  "inbound_hook_secrets",
  {
    accountId: uuid("account_id")
      .primaryKey()
      .references(() => accounts.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    tokenEnc: text("token_enc").notNull(),
    createdAt: createdAt(),
    rotatedAt: timestamp("rotated_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("inbound_hook_secrets_hash_uq").on(t.tokenHash)],
);

export type SubscriberSource = "ghl" | "webhook" | "hosted";

// One opt-in event (a "touch"), first-party data. Attribution fields are copied
// from the click the tracking id points at, so reports survive campaign
// deletion. A tid that is unknown or belongs to another account is kept but
// unattributed. Matching across touches happens in Phase 7.
export const subscribers = pgTable(
  "subscribers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    emailNorm: text("email_norm").notNull(),
    name: text("name"),
    source: text("source").$type<SubscriberSource>().notNull(),
    externalId: text("external_id"),
    // external_id, else tid, else "none": one row per email and touch.
    dedupeKey: text("dedupe_key").notNull(),
    tid: text("tid"),
    clickId: uuid("click_id"),
    linkId: uuid("link_id"),
    replyId: uuid("reply_id"),
    campaignId: uuid("campaign_id"),
    youtubeVideoId: text("youtube_video_id"),
    keyword: text("keyword"),
    // null = the source did not say; never assumed.
    consentMarketing: boolean("consent_marketing"),
    ghlContactId: text("ghl_contact_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("subscribers_touch_uq").on(t.accountId, t.source, t.emailNorm, t.dedupeKey),
    index("subscribers_account_email_idx").on(t.accountId, t.emailNorm),
    index("subscribers_account_occurred_idx").on(t.accountId, t.occurredAt),
    index("subscribers_tid_idx").on(t.tid),
  ],
);

export type PurchaseSource = "ghl" | "stripe" | "webhook";
export type PurchaseKind = "payment" | "buyer_marker";

// Every purchase event from every source is stored with its raw numbers
// (DECISIONS Q-05). `kind = buyer_marker` is a buyer without an amount (won
// opportunity or buyer tag, Q-06): revenue is "not reported", never estimated.
// Duplicates across sources are linked through `canonicalPurchaseId`
// (revenue counts once) and each purchase is attributed to a touch.
export const purchases = pgTable(
  "purchases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    source: text("source").$type<PurchaseSource>().notNull(),
    kind: text("kind").$type<PurchaseKind>().notNull().default("payment"),
    externalId: text("external_id").notNull(),
    emailNorm: text("email_norm"),
    tid: text("tid"),
    amountCents: bigint("amount_cents", { mode: "number" }),
    currency: text("currency"),
    refundedCents: bigint("refunded_cents", { mode: "number" }).notNull().default(0),
    // Subscription id of a recurring payment; every later payment of the same
    // subscription keeps the attribution of the first (DECISIONS Q-07).
    subscriptionRef: text("subscription_ref"),
    ghlContactId: text("ghl_contact_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    raw: jsonb("raw").$type<Record<string, unknown>>().notNull().default({}),
    // Phase 7 attribution (src/lib/attribution.ts), recomputed by the worker.
    // `canonicalPurchaseId` is the row's own id for the purchase that counts,
    // another row's id for a duplicate, null until computed. `netCents` is the
    // revenue it counts: amount minus refunds on canonical payments, 0 on
    // duplicates, null on buyer markers (revenue not reported).
    canonicalPurchaseId: uuid("canonical_purchase_id"),
    netCents: bigint("net_cents", { mode: "number" }),
    attributionMethod: text("attribution_method").$type<"tid" | "email" | "subscription">(),
    attributedSubscriberId: uuid("attributed_subscriber_id"),
    attributedClickId: uuid("attributed_click_id"),
    attributedReplyId: uuid("attributed_reply_id"),
    attributedCampaignId: uuid("attributed_campaign_id"),
    attributedVideoId: text("attributed_video_id"),
    attributedKeyword: text("attributed_keyword"),
    attributedIntent: text("attributed_intent").$type<Intent>(),
    attributedTouchAt: timestamp("attributed_touch_at", { withTimezone: true }),
    attributionComputedAt: timestamp("attribution_computed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("purchases_source_external_uq").on(t.accountId, t.source, t.externalId),
    index("purchases_account_email_idx").on(t.accountId, t.emailNorm),
    index("purchases_account_occurred_idx").on(t.accountId, t.occurredAt),
    index("purchases_tid_idx").on(t.tid),
    index("purchases_subscription_idx").on(t.accountId, t.subscriptionRef),
  ],
);
