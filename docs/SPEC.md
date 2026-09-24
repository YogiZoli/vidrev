# SPEC (technical specification)

Source: Drive doc "05 C2C SaaS SPEC (technical specification)", draft v1, 2026-09-24, with all "UPDATE" and "APPROVED" notes (2026-09-24/25) merged into the text they override, and the WITHDRAWN Python stack proposal removed. Decisions live in [DECISIONS.md](../DECISIONS.md) and win on any conflict. Product scope is in [PRD.md](PRD.md). Internal codename: `c2c-saas`.

Merge notes: env var `LINK_BASE_URL` is renamed `LINK_FALLBACK_BASE_URL` (CC-01); the tracking parameter is `c2c_tid` (CC-02); references to the legacy C2C app as a pattern are dropped (CC-04, D-30).

## 1. Principles

- Platform-independent core. GoHighLevel (GHL) is a connector, not the foundation.
- Only real metrics. No estimated values anywhere.
- Names and domains are configuration, never hardcoded (product name and domains are undecided).
- Boring, well-supported tech; low running cost during beta.
- YouTube and Google policy compliance is a hard requirement, not a feature.
- Performance: the UI never waits on YouTube or GHL; all external calls run in the worker; dashboards read precomputed aggregates; approvals use optimistic UI (D-36).

## 2. Stack (approved, D-36)

| Layer | Choice | Reason |
| --- | --- | --- |
| Language | TypeScript (Node.js LTS) | One language for web, worker and scripts |
| Web app and API | Next.js (App Router) | Dashboard, API routes and public pages in one service |
| Background jobs | Separate worker process using pg-boss (Postgres-backed queue) | No Redis needed, fewer services, lower cost |
| Database | PostgreSQL (Railway) | Relational data, transactional quota ledger |
| ORM and migrations | Drizzle ORM | Typed SQL, simple migrations |
| Email | Resend (magic links, audit reports, fallback resource email) | Simple API, good deliverability |
| Hosting | Railway project `c2c-saas`: services `web`, `worker`, plus Postgres | No Supabase, no Upstash, no Redis (D-29) |
| Tests | Vitest | Fast unit tests |

The tracked link redirect is served by the `web` service, routed by host name (user custom hostnames and the fallback link host). Split it into its own service only if traffic requires.

## 3. Architecture

```mermaid
flowchart LR
  subgraph GHL[GoHighLevel: brand.tld]
    L[Landing, pricing, checkout]
    W[Workflows]
  end
  subgraph CF[Cloudflare for SaaS]
    CH[Custom Hostnames: go.userdomain.com, TLS]
  end
  subgraph R[Railway project c2c-saas]
    WEB[web: app.brand.tld + link hosts]
    WK[worker: polling, replies, sync, retention]
    DB[(Postgres)]
  end
  YT[YouTube Data API]
  ST[Stripe]
  CRM[User CRM or form tool]
  L --> W -->|signed provisioning webhook| WEB
  CH -->|proxied link traffic| WEB
  WEB <--> DB
  WK <--> DB
  WK <-->|OAuth youtube.force-ssl| YT
  YT -->|PubSubHubbub push: new uploads| WEB
  WEB -->|redirect + c2c_tid| CRM
  CRM -->|opt-in: GHL read or inbound webhook| WEB
  WK -->|read purchases| ST
  WK -->|contacts, tags, won opportunities| GHL
  WK -->|HMAC outbound webhooks| CRM
```

## 4. Domains and configuration

ONE owner domain is enough (D-28).

| Role | Host | Runs on |
| --- | --- | --- |
| Brand, landing, pricing, checkout, Privacy, Terms | brand.tld | GHL |
| App (dashboard, API, OAuth callbacks, Audit my channel) | app.brand.tld | Railway `web` |
| Tracked links, default (MISSION CRITICAL, D-33) | the user's own domain, e.g. go.userdomain.com, via CNAME, automatic TLS through Cloudflare for SaaS (Custom Hostnames) | Railway `web` (host routing) |
| Tracked links, fallback for users without a domain | go.brand.tld | Railway `web` (host routing) |

Custom domains are a core MVP feature, not a stub. Google verification concerns only the app domain; one verified root domain (`brand.tld`) covers the Google OAuth consent screen homepage and privacy policy.

Environment variables (see `.env.example`): `PRODUCT_NAME`, `BRAND_BASE_URL`, `APP_BASE_URL`, `LINK_FALLBACK_BASE_URL`, `DATABASE_URL`, `ENCRYPTION_KEY` (32-byte, base64), `AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `WEBSUB_SECRET`, `YT_API_KEY_AUDIT` (separate GCP project), `RESEND_API_KEY`, `EMAIL_FROM`, `PROVISIONING_SECRET`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`, `CUSTOM_HOSTNAME_CNAME_TARGET`, `GHL_CLIENT_ID`, `GHL_CLIENT_SECRET`, `STRIPE_CONNECT_CLIENT_ID`, `STRIPE_SECRET_KEY`, `QUOTA_DAILY_LIMIT` (default 10000).

## 5. Data model (core tables)

| Table | Key fields |
| --- | --- |
| accounts | id, email, name, status (active, suspended, cancelled), plan_id, founding (bool), created_at |
| plans | id, code, label, price_label, billing (monthly, annual, one_time, free_grant), channel_limit, monthly_reply_cap, features (jsonb), seats_cap, seats_used, active |
| provisioning_events | id, source (ghl), external_id, type, payload (jsonb), received_at, processed_at (idempotency on external_id) |
| channels | id, account_id, youtube_channel_id, title, default_language, oauth_token_enc, token_expires_at, status, connected_at |
| videos | id, channel_id, youtube_video_id, title, published_at, poll_tier, last_polled_at |
| campaigns | id, channel_id, name, keyword, keyword_aliases, destination_url, mode (approval only, D-25), video_scope (all, list), active |
| templates | id, campaign_id, language, body, approved_at |
| comments | id, video_id, youtube_comment_id, author_channel_id, text, language, matched_campaign_id, fetched_at, refresh_due_at (API data, 30-day rule) |
| replies | id, comment_id, template_id, status (queued, pending_approval, sent, failed, skipped), youtube_reply_id, sent_at, error |
| links | id, campaign_id, video_id, slug |
| clicks | id, link_id, tracking_id (tid), comment_id, ip_hash, user_agent_class, is_bot, created_at |
| subscribers | id, account_id, email_norm, tid, campaign_id, video_id, source (ghl, webhook, hosted), consent_marketing, created_at |
| purchases | id, account_id, email_norm, amount_cents, currency, source (ghl, stripe, webhook), external_id, refunded_cents, occurred_at, attributed_subscriber_id |
| integrations | id, account_id, type (ghl, stripe, outbound_webhook), config_enc, status |
| outbound_deliveries | id, integration_id, event, payload, attempt, status, next_attempt_at |
| quota_ledger | id, gcp_project (app, audit), date_pt, method, units, account_id |
| audits | id, channel_handle, requester_email, result (jsonb), created_at, expires_at |

All `*_enc` fields are encrypted with AES-256-GCM using `ENCRYPTION_KEY`. Emails are normalized (trimmed, lowercased) for matching.

## 6. Plans and provisioning (billing lives in GHL)

- Plans are rows in `plans`, never code branches. Required seed plans:
  - `standard_monthly`: billing monthly, price configurable.
  - `founding` (D-24): billing annual, 97 USD per year, renewal price locked for life, seat cap 100.
  - `ghl_affiliate_free` (D-21): free app access for users who subscribe to GHL through the owner's affiliate link; granted manually or by webhook.
  - `enterprise` (D-32): BYOK, the customer's own GCP project and OAuth client.
  - `internal`: owner accounts.
  - No lifetime plan (D-20). No forever-free plan; the free entry point is Audit my channel (D-37).
- Trial (D-37): 14 days, card required, run by GHL checkout. Provisioning of the trial: see SPEC-REVIEW R-13 / Q-16.
- `POST /api/provisioning/ghl`: called by GHL workflows. Header `X-Signature` = HMAC-SHA256(body, `PROVISIONING_SECRET`). Idempotent on `external_id`.
  - `purchase` or `subscription_created`: create or activate account, assign plan, send magic link.
  - `subscription_cancelled`, `payment_failed`: suspend (data kept 30 days, then API data purged per policy).
  - `plan_changed`: switch plan.
- Payload fields: `event`, `external_id`, `email`, `name`, `plan_code`, `occurred_at`.
- Plan limits enforced in the worker: channel_limit on connect, monthly_reply_cap before each reply (excess replies become `skipped` with a visible reason).

## 7. YouTube integration

### OAuth

- Scopes: `openid email profile https://www.googleapis.com/auth/youtube.force-ssl`. Offline access, refresh tokens encrypted at rest. Revocation handled (mark channel disconnected, stop polling).
- Enterprise plan (D-32): BYOK, the customer's own GCP project and OAuth client with its own quota, selected per account; no on-premise.

### Polling and quota

- Channel-level listing: `commentThreads.list` with `allThreadsRelatedToChannelId`, `order=time`, page until the last seen comment. 1 unit per page. Never poll per video.
- Schedule is per CHANNEL and activity-based (D-27):
  - channel with a video published in the last 48h: every 2 min;
  - normal: every 15 min;
  - no upload in 14 days: every 60 min.
- Old videos cost nothing extra because one channel-level call covers all of them.
- New uploads are detected WITHOUT quota via YouTube PubSubHubbub push notifications (fallback: channel RSS feed), which switches the channel to the 2-minute tier for 48h.
- Daily quota budget: `QUOTA_DAILY_LIMIT` units per Pacific-time day for the app GCP project, shared by ALL customers. Reserve units for approved replies first; polls yield when the reply reserve is at risk.
- Reply scheduling (D-31): approved replies are spread evenly across the Pacific-time quota day so unused quota is not wasted; what does not fit today is sent first after the midnight PT reset.
- Approved replies that cannot be sent today stay in a transparent queue showing the estimated send time and an honest note that YouTube limits daily API actions, plus the manual "Copy reply and open comment on YouTube" fallback (0 units).
- Per-plan monthly reply caps apply.
- NEVER use multiple GCP projects for the same use case to increase quota (prohibited by the YouTube Developer Policies); a separate project is allowed only for a genuinely different use case (Audit my channel, D-34).
- The quota audit is an upside, not a dependency (D-27, D-35).
- Every API call writes a `quota_ledger` row (method, units). Before any call the worker checks remaining units for the Pacific-time day; replies get priority reservations. Dashboard shows today's usage.
- Unit costs: list calls 1, `comments.insert` 50.

### Reply engine

1. New comment: normalize, then match campaign keyword (case-insensitive, whole word, aliases).
2. Skip if: author is the channel owner, author already received a reply for this campaign, per-video or per-hour limit reached, plan cap reached.
3. Language (B-06): detect comment language; use an approved template in that language if one exists; else the channel `default_language` template; else English.
4. Draft: generated by AI with the user's OWN AI provider key (Anthropic Claude Haiku, OpenAI gpt-4o-mini or Google Gemini, encrypted at rest), falling back to approved templates when no key is set. Rotate among approved templates, insert first name when available, append the tracked link.
5. Every reply is a draft (`pending_approval`) until the creator approves it; there is NO auto mode (D-25).
6. After approval: scheduled by the quota budget, then sent via `comments.insert` (reply to the top-level comment) with 30 to 180 s jitter. Record result; retry transient errors with backoff; never retry policy errors.

- No machine translation of unapproved text.
- No like or subscribe requirements in templates (validated on save).

### Retention (30-day rule)

- Daily job: comments older than 30 days are either refreshed (batched `comments.list` by id, 1 unit per up to 50) while their campaign is active, or deleted. Aggregates (counts per video and keyword) are kept.

## 8. Tracked links

- Hosts: the user's own custom hostname by default (D-33), `LINK_FALLBACK_BASE_URL` for users without a domain.
- Format: `{link host}/{slug}`; slug is unique per campaign and video.
- On click: create a `tid` (short random id), log the click (bot filter by user agent and known crawlers), redirect 302 to `destination_url` with `c2c_tid={tid}` appended (preserving existing query parameters).
- Custom domain onboarding (core MVP, mission critical): the user adds a CNAME (e.g. go.userdomain.com) to the link service; the app verifies DNS and provisions automatic TLS via Cloudflare for SaaS (Custom Hostnames).

## 9. Opt-in capture (subscribers)

| Method | How |
| --- | --- |
| GHL (native connector) | User adds a hidden field `c2c_tid` to their GHL form. The worker reads new contacts with that field (GHL API or GHL webhook) and creates `subscribers` rows |
| Universal inbound webhook | `POST /api/hooks/optin` with `tid`, `email`, optional `name`; per-account secret. Works with any form tool via its webhook, Zapier, Make or n8n |
| Hosted fallback | Minimal hosted opt-in page plus resource email via Resend, for users without any system (D-08) |

Each opt-in emits outbound `opt_in` and applies tags where the connector supports it.

## 10. Purchases and attribution

- Sources: GHL (won opportunity or buyer tag, with value), Stripe (read-only via Stripe Connect OAuth: `checkout.session.completed`, `invoice.paid`, `charge.refunded`), universal inbound webhook `POST /api/hooks/purchase`.
- Matching: normalized email to subscriber. If the purchase carries a `c2c_tid`, prefer it.
- Attribution rule (default, configurable per account): **last touch** before the purchase within a 180-day window (B-08). Refunds reduce revenue.
- Metrics: buyers = unique purchasing emails; revenue = sum of net amounts.

## 11. Outbound webhooks

- Events: `comment_matched`, `reply_posted`, `link_clicked`, `opt_in`, `purchase`.
- Payload: `{ "event", "id", "occurred_at", "account_id", "channel_id", "video_id", "campaign", "keyword", "tid", "email" (opt_in/purchase only), "amount_cents", "currency" }`.
- Header `X-Signature` = HMAC-SHA256 of the raw body with the integration secret; `X-Event-Id` for idempotency. Retries with exponential backoff for 24 hours.
- Tag scheme for CRMs with tags: `c2c`, `c2c_kw_<keyword>`, `c2c_vid_<videoId>`, `c2c_buyer`.

## 12. Reporting

- Per video and per keyword: comments matched, replies sent, clicks, subscribers, buyers, revenue, conversion rates (reply to click to subscriber to buyer).
- Headline: "This month your comments made $X. Your subscription was $Y." (Y from the plan's price label).
- Date filters (this month, last 30/90 days, all time). All numbers derived from stored events; no estimates. Dashboards read precomputed aggregates.
- UI vocabulary: Comment, Subscriber, Buyer, Revenue (B-01).

## 13. Audit my channel

- Public page on `app.brand.tld/audit`. API key from a separate GCP project (`YT_API_KEY_AUDIT`, D-34), no OAuth.
- Calls: `channels.list` (`forHandle`), `playlistItems.list` (last 5 videos), `commentThreads.list` per video (up to 2 pages). About 5 to 15 units per audit; own `quota_ledger` project.
- Output (real numbers only): unanswered questions, buying-intent comments, repeated words as keyword candidates, description link audit (tracked or not, own domain or not), stack detection by following description links (GHL, Kit, Kajabi and others; same signatures as the 03 research), Comment Conversion Score 0 to 100 from these factors.
- Instant preview (3 findings), then full report by email (opt-in, consent recorded), then trial CTA. 24h cache per channel, IP rate limit, raw comments deleted within 30 days.

## 14. GHL Marketplace connector

- A free GHL Marketplace app (location-level OAuth, D-22). On install: store tokens in `integrations`, map the location to an account (existing or invite), create the `c2c_tid` custom field and tags.
- Capabilities: write contacts and tags; read contacts with `c2c_tid`; read won opportunities and buyer tags; optional workflow trigger ("C2C subscriber created") and action ("Add note: C2C source").
- The connector does not handle billing.

## 15. Security and compliance

- Secrets only in env vars; `.env` git-ignored. Tokens, AI keys and integration configs encrypted at rest.
- Inbound webhooks verified by HMAC; outbound signed. Rate limits on public endpoints.
- Privacy Policy and Terms (drafts, marked "DRAFT - needs legal review") on `brand.tld`: YouTube API Services disclosure, link to the Google Privacy Policy, data accessed and stored, revocation via Google security settings, Limited Use statement, link to YouTube Terms of Service.
- No Google user data used for model training. Account deletion removes all personal data.
- No "YouTube", "YT", "Tube" or "GHL" in product naming (D-23).
- Owner entity: Wyoming LLC (not formed yet, D-13).

## 16. Observability

- Structured logs, error tracking (Sentry free tier or equivalent), health endpoint, worker heartbeat, quota and delivery dashboards for the owner.

## 17. Testing

- Unit: keyword matching, language cascade, template validation, quota accounting and reply scheduling, plan caps, custom domain verification, HMAC signing and verification, attribution matching (email, tid, window, refunds).
- Integration: provisioning webhook idempotency, redirect and tid propagation, retention job.
- Manual: OAuth connect, end-to-end on the owner's channel before any customer.

## 18. Open decisions (owner)

1. Product name and domains (env vars until decided). **Open.**
2. Founding offer: **resolved** (D-24). Pricing structure: **resolved** (D-37). Standard monthly price: **open**, configurable.
3. Attribution rule default: **resolved**, last touch within 180 days (B-08).
4. Whether the new SaaS replaces the legacy GHL Marketplace app: **resolved**, yes, legacy frozen then retired (D-26).
