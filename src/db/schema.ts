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
    createdAt: createdAt(),
  },
  (t) => [
    index("channels_account_idx").on(t.accountId),
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
