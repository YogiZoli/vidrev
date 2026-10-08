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
  primaryKey,
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
  // Numeric price for the report headline (Q-09); null until decided.
  priceCents: bigint("price_cents", { mode: "number" }),
  priceCurrency: text("price_currency"),
  channelLimit: integer("channel_limit").notNull(),
  monthlyReplyCap: integer("monthly_reply_cap"),
  dailyReplyCap: integer("daily_reply_cap"),
  seatsCap: integer("seats_cap"),
  features: jsonb("features").$type<Record<string, unknown>>().notNull().default({}),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

// "registered": signed up on the app, not paid yet; locked until a checkout
// activates it (provisioning turns it "active").
export type AccountStatus = "registered" | "active" | "suspended";
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
  // Q-08: "default" (USD), "source" (the currency of the connected revenue
  // source, set by the worker) or "creator" (chosen by hand, never overridden).
  reportingCurrencySource: text("reporting_currency_source").$type<"default" | "source" | "creator">().notNull().default("default"),
  // Calendar days of the reports ("this month") are counted in this zone.
  reportTimezone: text("report_timezone").notNull().default("UTC"),
  // Retention emails (R-35): weekly summary (opt-out), milestones announced
  // once each and the renewal recap, keyed in `milestones`.
  weeklyEmail: boolean("weekly_email").notNull().default(true),
  weeklyEmailSentAt: timestamp("weekly_email_sent_at", { withTimezone: true }),
  milestones: jsonb("milestones").$type<Record<string, string>>().notNull().default({}),
  // AI drafting (DECISIONS Q-13c): "platform" uses the owner's billing-enabled
  // Gemini key; otherwise the account's own key, encrypted at rest.
  aiProvider: text("ai_provider").$type<AiProvider>().notNull().default("platform"),
  aiKeyEnc: text("ai_key_enc"),
  aiModel: text("ai_model"),
  // Onboarding (Phase 14): the app, polling and drafts stay locked until it is
  // complete. `purchaseSource` names what counts as a purchase; links point to
  // `defaultTargetUrl` unless a campaign says otherwise.
  onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
  purchaseSource: text("purchase_source").$type<"ghl" | "stripe">(),
  defaultTargetUrl: text("default_target_url"),
  // Last "drafts are waiting" email, so the notification is throttled.
  draftsNotifiedAt: timestamp("drafts_notified_at", { withTimezone: true }),
  // Owner kill switch for the shared fallback link host (R-20).
  fallbackLinksBlocked: boolean("fallback_links_blocked").notNull().default(false),
  // Reports (Phase 7): set when new first-party data arrives; the worker
  // recomputes attribution and report snapshots and clears it.
  reportDirtyAt: timestamp("report_dirty_at", { withTimezone: true }),
  reportsComputedAt: timestamp("reports_computed_at", { withTimezone: true }),
  // How the account got access (DECISIONS A-20): checkout, trial, coupon,
  // partner_snapshot (GHL affiliate snapshot marker) or partner_admin.
  accessSource: text("access_source").$type<AccessSource>(),
  // One free trial per account, by trial button or trial coupon.
  trialUsedAt: timestamp("trial_used_at", { withTimezone: true }),
  // CRM sync mode (DECISIONS A-25): "clean" sends a commenter to the CRM only
  // after opt-in; "beast" makes every keyword commenter a prospect contact at
  // comment time. Beast counts only while the account is on BEAST_MODE_ACCOUNTS.
  crmSyncMode: text("crm_sync_mode").$type<CrmSyncMode>().notNull().default("clean"),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CrmSyncMode = "clean" | "beast";
export type AccessSource ="checkout" | "trial" | "coupon" | "partner_snapshot" | "partner_admin";
export type CouponKind = "partner" | "trial";

// Owner-made codes (admin): "partner" gives Partner access for good, "trial"
// gives `days` of full access. Stored upper case.
export const coupons = pgTable("coupons", {
  code: text("code").primaryKey(),
  kind: text("kind").$type<CouponKind>().notNull(),
  days: integer("days"),
  maxUses: integer("max_uses"),
  uses: integer("uses").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  note: text("note"),
  createdBy: text("created_by").notNull(),
  createdAt: createdAt(),
});

export const couponRedemptions = pgTable(
  "coupon_redemptions",
  {
    code: text("code")
      .notNull()
      .references(() => coupons.code, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    redeemedAt: timestamp("redeemed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("coupon_redemptions_uq").on(t.code, t.accountId)],
);

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
    // scrypt hash (src/lib/password.ts); null until the user sets a password.
    passwordHash: text("password_hash"),
    // Google account id for "Continue with Google" (openid only, no YouTube scope).
    googleSub: text("google_sub"),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("users_email_uq").on(t.email), uniqueIndex("users_google_sub_uq").on(t.googleSub), index("users_account_idx").on(t.accountId)],
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
    // Set when a Video Publishing Card armed this rule (DECISIONS A-30).
    publishingCardId: uuid("publishing_card_id"),
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

export type ContactStage = "commenter" | "subscriber" | "buyer";
export type ContactCreatedVia = "comment" | "opt_in" | "purchase" | "crm_sync" | "backfill";
export type ContactIdentityKind = "youtube_channel" | "email" | "ghl_contact" | "stripe_customer" | "comment";

// One person per account for the whole life of the account (DECISIONS Q-23,
// section 13). Created only when no existing Contact can be recognised; every
// later event enriches it, and two Contacts found by one event are merged into
// the older one (`mergedIntoId` marks the loser, kept as a tombstone).
export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    stage: text("stage").$type<ContactStage>().notNull().default("commenter"),
    // Earliest attributed opt-in email; other emails are aliases (identities).
    primaryEmailNorm: text("primary_email_norm"),
    // Only what the person gave in an opt-in or purchase, never a YouTube name.
    displayName: text("display_name"),
    createdVia: text("created_via").$type<ContactCreatedVia>().notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    firstCommentSeenAt: timestamp("first_comment_seen_at", { withTimezone: true }),
    subscribedAt: timestamp("subscribed_at", { withTimezone: true }),
    firstPurchaseAt: timestamp("first_purchase_at", { withTimezone: true }),
    mergedIntoId: uuid("merged_into_id"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("contacts_account_idx").on(t.accountId, t.firstSeenAt),
    index("contacts_account_stage_idx").on(t.accountId, t.stage),
    index("contacts_email_idx").on(t.accountId, t.primaryEmailNorm),
  ],
);

// The keys that recognise a Contact. Unique per account, kind and value, so a
// key can point to one Contact only, by construction (invariant I-8). The
// `youtube_channel` kind is YouTube API data: refreshed every 30 days and
// wiped on disconnect (section 13.9).
export const contactIdentities = pgTable(
  "contact_identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    kind: text("kind").$type<ContactIdentityKind>().notNull(),
    value: text("value").notNull(),
    source: text("source").notNull(),
    // Channel the YouTube identity came from, so a disconnect can wipe it.
    channelId: uuid("channel_id"),
    // The comment that last showed this channel id: the retention job asks
    // YouTube for it again to confirm the id for another 30 days.
    refCommentId: text("ref_comment_id"),
    refreshDueAt: timestamp("refresh_due_at", { withTimezone: true }),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("contact_identities_key_uq").on(t.accountId, t.kind, t.value),
    index("contact_identities_contact_idx").on(t.contactId),
    index("contact_identities_refresh_idx").on(t.kind, t.refreshDueAt),
  ],
);

// Audit log of merges: what joined two Contacts and what moved, the basis for
// an undo (section 13.6, M-4).
export const contactMerges = pgTable(
  "contact_merges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    winnerId: uuid("winner_id").notNull(),
    loserId: uuid("loser_id").notNull(),
    reason: text("reason").notNull(),
    moved: jsonb("moved").$type<Record<string, number>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("contact_merges_winner_idx").on(t.accountId, t.winnerId)],
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
    // The person who wrote the comment (section 13); first-party, kept.
    contactId: uuid("contact_id"),
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
    // Beast Mode thread (A-25): when the comment and draft went into the CRM
    // thread, and the CRM message that approved it (its status follows the send).
    crmThreadedAt: timestamp("crm_threaded_at", { withTimezone: true }),
    crmMessageId: text("crm_message_id"),
    crmStatusSentAt: timestamp("crm_status_sent_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("replies_account_status_idx").on(t.accountId, t.status),
    index("replies_status_idx").on(t.status, t.queuedForDatePt),
    index("replies_contact_idx").on(t.contactId),
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

// "card": issued for a Video Publishing Card keyword before the video exists
// (DECISIONS A-30); it behaves like a static link and is tied to the video on publish.
export type LinkKind = "reply" | "static" | "card";

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
// click id carried to the opt-in page as vidrev_tid. Campaign, video and keyword
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
    // From the reply the link was minted for; set later by an opt-in for a
    // static-link click (section 13).
    contactId: uuid("contact_id"),
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
    index("clicks_contact_idx").on(t.contactId),
  ],
);

export type IntegrationType = "outbound_webhook" | "ghl" | "stripe";
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
    contactId: uuid("contact_id"),
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
    index("subscribers_contact_idx").on(t.contactId),
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
    contactId: uuid("contact_id"),
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
    index("purchases_contact_idx").on(t.contactId),
  ],
);

// Precomputed reports (SPEC section 12, D-36): one row per account and period,
// rebuilt by the worker after new data. Dashboards only read these. The data
// holds first-party numbers and ids only, never YouTube titles.
export const reportSnapshots = pgTable(
  "report_snapshots",
  {
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    period: text("period").notNull(),
    data: jsonb("data").notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.period] })],
);

// Audit my channel (SPEC section 13, DECISIONS section 16). One row per
// request; `id` is the unguessable token in the result URL. `result` holds
// counts and derived numbers only. Everything that came from the YouTube API
// (`youtube_channel_id`, `examples`) is wiped 30 days after `fetched_at`.
export const audits = pgTable(
  "audits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Normalised lookup key of the channel ("handle:name", "id:UC...") for the 24h cache.
    channelKey: text("channel_key").notNull(),
    // What the visitor typed, trimmed.
    channelInput: text("channel_input").notNull(),
    status: text("status").notNull().default("queued"),
    failureReason: text("failure_reason"),
    youtubeChannelId: text("youtube_channel_id"),
    result: jsonb("result").$type<import("@/lib/audit/result").AuditResult>(),
    examples: jsonb("examples").$type<import("@/lib/audit/result").AuditExamples>(),
    // When the YouTube data was read; a cache hit keeps the original time.
    fetchedAt: timestamp("fetched_at", { withTimezone: true }),
    apiDataScrubbedAt: timestamp("api_data_scrubbed_at", { withTimezone: true }),
    requesterEmail: text("requester_email"),
    consentMarketing: boolean("consent_marketing"),
    consentAt: timestamp("consent_at", { withTimezone: true }),
    reportSentAt: timestamp("report_sent_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("audits_channel_idx").on(t.channelKey, t.createdAt),
    index("audits_email_idx").on(t.requesterEmail, t.reportSentAt),
    index("audits_fetched_idx").on(t.fetchedAt),
  ],
);

// A GoHighLevel install started from the Marketplace listing (Phase 10): the
// installer is not signed in here yet, so the grant waits for a signed-in
// account to claim it. `claimHash` is the sha256 of the claim token the
// installer's browser holds; `configEnc` seals the token response. Unclaimed
// rows are deleted after `expiresAt`, claimed ones at once.
export const ghlInstalls = pgTable(
  "ghl_installs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    locationId: text("location_id").notNull(),
    claimHash: text("claim_hash").notNull(),
    configEnc: text("config_enc").notNull(),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("ghl_installs_claim_uq").on(t.claimHash), index("ghl_installs_location_idx").on(t.locationId), index("ghl_installs_expires_idx").on(t.expiresAt)],
);

export type CrmProspectStatus =
  // Our row is claimed, the CRM create call has not answered yet.
  | "creating"
  // The contact exists in the CRM; ghlContactId is what our create call returned.
  | "created"
  // Opted in: merged into the email contact (PR4); never deleted by the 29 day rule.
  | "opted_in"
  // A create call that never confirmed: not retried (a second create could duplicate).
  | "unconfirmed"
  // Deleted from the CRM by the 29 day rule.
  | "deleted"
  // The live re-read failed an ownership proof: left in the CRM, never touched again.
  | "kept"
  // The CRM delete did not work within the grace days: our side scrubbed anyway.
  | "abandoned";

// Beast Mode prospect contacts (DECISIONS A-25, A-27): one row per Contact
// that vidrev itself created in the CRM. The row is the first proof that a CRM
// contact is ours; the "vidrev prospect id" field on the contact (this row's
// id) is the second, checked live before any delete. No YouTube data is kept
// here: the display name goes to the CRM only.
export const crmProspects = pgTable(
  "crm_prospects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").notNull(),
    integrationId: uuid("integration_id").references(() => integrations.id, { onDelete: "set null" }),
    ghlLocationId: text("ghl_location_id"),
    ghlContactId: text("ghl_contact_id"),
    // The Conversations thread of our provider (PR3); deleted with the contact.
    ghlConversationId: text("ghl_conversation_id"),
    // Opt-in merge (A-27): the email contact that took over, and when its
    // tags and thread summary were written (before the prospect is deleted).
    mergedIntoGhlContactId: text("merged_into_ghl_contact_id"),
    mergeCopiedAt: timestamp("merge_copied_at", { withTimezone: true }),
    status: text("status").$type<CrmProspectStatus>().notNull().default("creating"),
    // 29 days after the first comment unless they opt in.
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    deleteAttempts: integer("delete_attempts").notNull().default(0),
    lastError: text("last_error"),
    // Dry run: when the sweep last found it due (would have deleted it).
    wouldDeleteAt: timestamp("would_delete_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One live prospect per person and CRM connection; a deleted one may be
    // followed by a new one, and another sub-account gets its own.
    uniqueIndex("crm_prospects_live_uq")
      .on(t.accountId, t.contactId, t.integrationId)
      .where(sql`status in ('creating', 'created', 'unconfirmed')`),
    uniqueIndex("crm_prospects_ghl_contact_uq").on(t.ghlLocationId, t.ghlContactId),
    index("crm_prospects_due_idx").on(t.status, t.expiresAt),
  ],
);

// The CRM copy of a deleted prospect, kept 24 hours for an owner restore
// (A-27 safety belt). Deleted on the 29th day, so with these 24 hours the
// YouTube display name inside never outlives 30 days.
export const crmProspectBackups = pgTable(
  "crm_prospect_backups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    prospectId: uuid("prospect_id")
      .notNull()
      .references(() => crmProspects.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    contact: jsonb("contact").$type<Record<string, unknown>>().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    restoredAt: timestamp("restored_at", { withTimezone: true }),
    restoredGhlContactId: text("restored_ghl_contact_id"),
    createdAt: createdAt(),
  },
  (t) => [index("crm_prospect_backups_expires_idx").on(t.expiresAt)],
);

// Publishing Dream Team (PDT) connection (DECISIONS A-30 to A-36). A creator
// allows PDT on /connect/pdt; PDT trades the one-time code for a token. Only
// hashes are stored. One live connection per account.
export const pdtConnectCodes = pgTable(
  "pdt_connect_codes",
  {
    codeHash: text("code_hash").primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    redirectOrigin: text("redirect_origin").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("pdt_connect_codes_account_idx").on(t.accountId)],
);

export const pdtConnections = pgTable(
  "pdt_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    tokenHash: text("token_hash").notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("pdt_connections_token_uq").on(t.tokenHash),
    uniqueIndex("pdt_connections_live_account_uq").on(t.accountId).where(sql`revoked_at is null`),
  ],
);

// A Video Publishing Card (video-publishing-card/1) as PDT sent it, stored
// verbatim (timestamps and all) by its cardId. First-party data: nothing in it
// was read from YouTube. `youtubeVideoId` is set once PDT reports the publish.
export const publishingCards = pgTable(
  "publishing_cards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    cardId: uuid("card_id").notNull(),
    card: jsonb("card").$type<Record<string, unknown>>().notNull(),
    youtubeVideoId: text("youtube_video_id"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("publishing_cards_account_card_uq").on(t.accountId, t.cardId), index("publishing_cards_video_idx").on(t.accountId, t.youtubeVideoId)],
);

export type CardKeywordState = "pending" | "armed" | "already_live" | "not_armed";

// One keyword of a card: its tracked link from the start, and what happened
// on publish. "pending" is the waiting automation: no campaign exists yet, so
// nothing is polled, drafted or spent for it.
export const publishingCardKeywords = pgTable(
  "publishing_card_keywords",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    cardRowId: uuid("card_row_id")
      .notNull()
      .references(() => publishingCards.id, { onDelete: "cascade" }),
    keyword: text("keyword").notNull(),
    intent: text("intent").$type<Intent>().notNull(),
    // The card's offer for this keyword ("gets"), kept with the card; not used (A-34).
    gets: text("gets"),
    linkId: uuid("link_id").notNull(),
    state: text("state").$type<CardKeywordState>().notNull().default("pending"),
    stateReason: text("state_reason"),
    campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
    youtubeVideoId: text("youtube_video_id"),
    armedAt: timestamp("armed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("publishing_card_keywords_uq").on(t.cardRowId, t.keyword),
    index("publishing_card_keywords_video_idx").on(t.accountId, t.youtubeVideoId, t.keyword),
  ],
);
