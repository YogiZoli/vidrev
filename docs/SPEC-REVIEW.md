# SPEC review (Phase 1)

Date: 2026-09-25. Reviewed: [SPEC.md](SPEC.md), [PRD.md](PRD.md), [DECISIONS.md](../DECISIONS.md) (D-01 to D-37).

This document lists gaps, risks and the decisions needed from the owner, each with a proposed fix. **SPEC.md is not changed yet**: after the owner answers section 3, the accepted fixes are merged into SPEC.md and DECISIONS.md at the start of Phase 2.

Severity: **Critical** = would make the product fail or break a hard rule; **High** = would cause wrong numbers, a security hole or a large rework; **Medium** = must be specified before the phase that builds it; **Low** = cleanup.

## 1. Top findings

1. **Quota capacity (Critical, R-01).** With the D-27 tiers, one weekly-uploading channel costs about 274 units per day in polling alone. 10,000 units shared by all customers covers about 36 such channels with zero replies. The 100 founding seats (D-24) need about 27,400 units per day just to poll. The quota extension is not a dependency for the first cohort, but it is for anything above roughly 30 active channels. This needs a budget-driven scheduler, an onboarding gate and small reply caps until the extension is approved.
2. **Critical path is the product name and domain (Critical, R-02).** Google OAuth verification, the Resend sending domain, the Cloudflare zone and the customer CNAME target all need the final domain. Until verification, the OAuth app runs in Testing mode, which means max 100 test users and refresh tokens that expire after 7 days. Compliance work (Phase 12) is scheduled too late for that.
3. **Custom domains need the owner zone on Cloudflare (Critical, R-03).** Cloudflare for SaaS works only if brand.tld DNS is on Cloudflare. Railway will reject unknown Host headers, so the routing needs a Host header override. The architecture is feasible on the free plan (100 hostnames included, then 0.10 USD per hostname per month), but it must be proven with a spike.
4. **Revenue can be double counted (High, R-04).** A sale made through GHL with Stripe connected shows up both in GHL and in Stripe.
5. **"Signed" inbound webhooks are not possible from GHL workflows (High, R-05).** The GHL Custom Webhook action supports Bearer, API key, Basic and OAuth2 auth, not an HMAC of the body. Zapier and most form tools cannot sign either.
6. **The data model cannot do last-touch attribution or per-reply tracking (High, R-06, R-07).** There is no opt-in history, no reply text column, no custom domain table and no user/session tables.
7. **AI drafts: prompt injection and a model training risk (High, R-08).** A comment is untrusted input. A free-tier Gemini key may allow Google to use the content for training, which conflicts with B-07.
8. **The 30-day retention scope is incomplete (High, R-09).** It covers comments only, but video titles, channel titles, commenter names and reply ids are API data too.

## 2. Findings and proposed fixes

### Quota and polling

**R-01 Quota capacity (Critical).** Polling cost per channel per day at one page per poll: fresh tier (2 min) 720 units, normal (15 min) 96, quiet (60 min) 24. A channel uploading weekly spends 48h of every 168h in the fresh tier: 0.29 x 720 + 0.71 x 96 = about 274 units per day. Twice weekly: about 452.

| Active channels (weekly upload) | Polling units/day at D-27 tiers | Left for replies (of 10,000) | Replies/day, all customers |
| --- | --- | --- | --- |
| 10 | 2,740 | 7,260 | 145 |
| 20 | 5,480 | 4,520 | 90 |
| 30 | 8,220 | 1,780 | 35 |
| 36 | 9,860 | 140 | 2 |
| 100 | 27,400 | none | none |

Proposed fix (keeps D-27 intact):
- Poll only channels with at least one active campaign. Other channels cost 0 units.
- The D-27 tier intervals become *targets*. A global scheduler stretches all intervals by one factor when the sum would exceed the polling budget. Example: 100 weekly channels with a 6,000-unit polling budget means a factor of about 4.6 (fresh every 9 min, normal every 69 min). Every reply waits for human approval anyway, so the real reply latency is set by the creator, not by the 2-minute poll.
- Fixed reply reserve: proposal 50% of the daily limit.
- Onboarding gate: a capacity check before a new channel can activate campaigns. Above the limit, the channel goes on a waitlist with an honest message.
- Submit the quota extension as soon as the owner's channel runs end to end (see R-15). D-35 says approval can take days to months.
- Decision: Q-02, Q-03.

**R-12 Fair share across customers (High).** The 10,000 units are shared (D-31). Without fairness, one busy creator can use the whole reply reserve for the day. Fix: each account gets a daily reply share (reply reserve divided by active accounts, weighted by plan). Unused share is redistributed in the afternoon (PT). The send queue is round-robin by account and FIFO within an account.

**R-18 Reply pacing, precisely (Medium).** "Spread evenly across the PT day" (D-31) needs an exact formula. Proposal: at time t, allowed reply units so far = reply reserve x (fraction of the PT day elapsed) + a burst allowance of 20% of the reserve. Anything above waits. Leftover at midnight PT is sent first (D-31). The estimated send time shown in the queue comes from the same formula. Quota reservations are made in a single transaction with a row lock on the daily budget row, so parallel worker jobs cannot overspend.

**R-17 PubSubHubbub details (Medium).**
- Google's hub caps leases at 432,000 s (5 days), so a renewal job has to re-subscribe every channel about every 4 days.
- Notifications also fire on title and description updates. A video counts as new only if its id has not been seen and it was published in the last 48h.
- Verify `X-Hub-Signature` with `hub.secret` (this is `WEBSUB_SECRET`).
- RSS fallback: fetch the channel feed every 30 min. It costs no quota.

**R-19 Polling mechanics (Medium).**
- pg-boss cron has minute granularity. Instead of one cron per channel, one dispatcher job runs every minute and enqueues channels whose `next_poll_at` has passed.
- Pagination stops at the last seen comment's published time.
- Only top-level comments trigger replies (Q-19).
- Comments held for review are not returned by the API, and that is fine.
- Videos with comments disabled return 403 on insert: mark the reply `skipped` with the reason.

### Critical path and compliance

**R-02 Name and domain block verification (Critical).** Google OAuth verification of `youtube.force-ssl` needs:
- a homepage and a privacy policy on the verified domain;
- an app name that matches the brand and follows D-23;
- a demo video.

In Testing mode the app is limited to 100 test users and refresh tokens expire after 7 days, so beta customers would have to reconnect every week. Resend needs a verified sending domain before magic links can reach real users (the Resend test sender only delivers to the account owner). The CNAME target must be final before the first customer sets up DNS, because changing it breaks every customer link. Fix: Phases 2 to 4 run on the Railway domain in Testing mode; the name and domain are needed before Phase 5 goes live (Q-01).

**R-15 Phase plan adjustments (High).**
- (a) Move Privacy/Terms drafts, the OAuth verification pack and the quota extension request out of Phase 12 and right after Phase 5. The external review time runs in parallel with Phases 6 to 11.
- (b) GHL OAuth always goes through a GHL Marketplace app (private or public). Phase 6 creates the one app (private), Phase 10 adds the connector features and the public listing. Two separate apps would be duplicated work.
- (c) The 30-day retention job belongs in Phase 4, not Phase 12, because it is a condition of storing comments at all.
- (d) A small Cloudflare for SaaS spike in Phase 2, if a test domain is available (Q-15).
- (e) Stripe Connect: confirm in Phase 8 that read-only OAuth is still offered for Standard accounts. If not, a Stripe App is the fallback.

**R-09 Retention scope (High).** API data that must be refreshed or deleted within 30 days (B-07, D-04):
- comment text, `author_channel_id`, author display name;
- `videos.title`;
- `channels.title`;
- `youtube_reply_id`.

The daily job must cover all of them (`videos.list` and `channels.list` cost 1 unit per 50 ids). The rule "author already received a reply for this campaign" needs memory beyond 30 days: store a keyed HMAC of the author channel id instead of the id itself (Q-14, legal review). Reports must be built on first-party events (replies we sent, clicks, opt-ins, purchases). The number of matched comments per video is kept only as an aggregate count.

**R-32 Branding requirements (Low).** YouTube API Services branding guidelines apply wherever YouTube data is displayed. Covered in Phase 12.

### Custom domains and links

**R-03 Custom domain architecture (Critical).** Verified facts:
- Cloudflare for SaaS runs on a zone added to Cloudflare, on any plan.
- 100 custom hostnames are included, then 0.10 USD each per month, max 50,000.
- Custom origin server per hostname is now available on Free, Pro and Business plans.
- Origin Rules can override the Host header.

Proposed setup:
- brand.tld DNS moves to Cloudflare. The GHL records for brand.tld stay DNS-only.
- A proxied `proxy-fallback.brand.tld` CNAME points to the Railway web service and is set as the fallback origin.
- `CUSTOM_HOSTNAME_CNAME_TARGET` = `customers.brand.tld`, a proxied CNAME to the fallback.
- An Origin Rule overrides the Host header to the Railway service domain for custom hostname traffic. A request header transform rule adds `X-Original-Host` with the original host, and the app routes by that header.
- Customers create `go.userdomain.com CNAME customers.brand.tld`. The app creates the custom hostname via API with HTTP DCV validation, then polls hostname and certificate status in the worker and shows the state in onboarding.
- Apex domains are not supported. Customers who proxy their own record on their own Cloudflare account need an extra note (orange-to-orange setup).

Decision: Q-15.

**R-07 Link granularity and host binding (High).** SPEC gives one link per campaign and video, so `clicks.comment_id` can never be filled. Fix:
- Two link kinds: `reply` (one short slug per sent reply, which gives exact comment-level data) and `static` (per campaign and video, for descriptions and pinned comments).
- Slugs are globally unique, so any link host can resolve them.
- A posted reply keeps its host forever. Changing it later costs 50 units per `comments.update`. If a customer removes their domain, their old links still resolve on the fallback host, but only if their DNS still points to us. The app warns before removal.

**R-20 Link abuse and security (Medium).**
- The destination must match the campaign's configured `destination_url`, so there is no open redirect.
- Destinations are checked against Google Safe Browsing on save.
- The fallback domain's reputation is shared across customers, so there is an owner kill switch per account.
- `ip_hash` uses a daily rotating salt.

**R-34 Optional later (Low).** On the customer's own domain, the redirect can set a first-party cookie on the parent domain with the `tid`. This keeps attribution when the visitor opts in in a later session. Not in the MVP.

### Webhooks and provisioning

**R-05 Inbound authentication (High).**
- Provisioning: `Authorization: Bearer <PROVISIONING_SECRET>`, compared in constant time, HTTPS only. Idempotency on the pair (event, external_id), because the same subscription id arrives with both `purchase` and `subscription_cancelled`. If an `X-Signature` HMAC is present, it is verified too.
- Universal opt-in and purchase hooks: a per-account secret token in a header (or in the URL for tools that cannot set headers), with optional HMAC.
- GHL Marketplace webhooks are signed by GHL with Ed25519 (`X-GHL-Signature`; the legacy `X-WH-Signature` was deprecated on 2026-09-01). Verify them with GHL's public key.
- Outbound webhooks stay HMAC-signed as specified.
- This changes the brief's "signed provisioning webhook" wording: Q-04.

**R-13 Trial handling (D-37) (High).** The 14-day trial with card lives in GHL checkout.
- Provisioning needs `trial_started`, which creates an active account with `trial_ends_at`.
- A successful first payment arrives as `purchase`. A failed charge at trial end arrives as `payment_failed`, which suspends the account.
- Trial accounts use the shared quota, so they get a small trial reply cap.
- Docs mismatch: the PRD audit ladder says "measure these comments for 7 days", the trial is 14 days.
- Decision: Q-16 (does the founding offer have a trial).

**R-14 Founding seat cap (Medium).** The sale happens in GHL, so only GHL can stop selling at 100. The app never rejects a paid purchase. It counts founding accounts and emails the owner at 90 and at 100.

**R-30 Idempotency key (Low).** Covered in R-05: (event, external_id), not external_id alone.

### Attribution and revenue

**R-04 Double counting (High).** Fix: each account picks exactly one revenue source of truth (GHL payments, Stripe or the inbound webhook). The other sources can still mark a buyer, but they never add revenue. Within one source, dedupe on the source's external id. Decision: Q-05.

**R-10 Revenue semantics (High).**
- (a) GHL "won opportunity" underreports. Many creators sell through GHL payments (orders, transactions, invoices), which carry real amounts. Proposal: GHL payments are the primary GHL revenue signal, and the won opportunity value is an option (Q-06).
- (b) A buyer tag has no amount. It counts a buyer and shows revenue as "not reported". It is never estimated (D-05).
- (c) Recurring payments: each payment is attributed independently if it falls within 180 days of the last touch (Q-07).
- (d) Currency: amounts are stored in their original currency. The headline sums the account's reporting currency only, and other currencies are listed separately, with no FX conversion (Q-08).
- (e) Refunds: Stripe `charge.refunded`. GHL refund signals must be verified in Phase 6.

**R-06 Data model gaps (High).** Proposed additions and changes, merged into SPEC section 5 after approval:

| Table | Change |
| --- | --- |
| users, sessions, magic_link_tokens | New. One user per account for the MVP. Tokens are stored hashed, single use, 15 min. |
| replies | Add `body`, `language`, `drafted_by` (ai, template), `approved_at`, `approved_by`, `scheduled_for`, `link_id`, status `manual_sent`. |
| touches | New: opt-in events (subscriber_id, tid, link_id, campaign_id, video_id, occurred_at). Last-touch attribution needs this history; `subscribers` becomes unique per (account, email_norm). |
| custom_domains | New: account_id, hostname, cloudflare_hostname_id, dns_status, ssl_status, verified_at, last_checked_at. |
| ai_credentials | New: account_id, provider, model, key_enc, paid_tier_confirmed. |
| gcp_projects | New: id, kind (app, audit, enterprise), account_id (enterprise only), client_id, client_secret_enc. `quota_ledger.gcp_project` becomes a foreign key. Needed for D-32. |
| inbound_hook_secrets | New: per-account token for the opt-in and purchase hooks. |
| daily_stats | New: precomputed aggregates per account, video, campaign and day (D-36). |
| audit_log | New: approvals, plan changes, admin actions. |
| accounts | Add `trial_ends_at`, `reporting_currency`, `revenue_source`. Drop `founding` (the plan says it). |
| plans | Drop `seats_used` (count it instead). Add `trial_reply_cap`. |
| links | Add `kind` (reply, static), `host`. |
| comments | Add `author_hash`, `author_display_name` (API data, 30-day rule). |

**R-26 Suspension and deletion (Medium).**
- Suspended: stop polling and sending, keep first-party data, purge API data after 30 days.
- Account deletion: delete all personal data, including subscribers and purchases, and revoke Google tokens.
- To be specified in Phase 3.

### Reply engine and AI

**R-08 AI safety and compliance (High).**
- The comment text goes into the prompt as clearly delimited data.
- The model never writes URLs: code strips any URL from the output and appends the tracked link.
- Length cap: 500 characters.
- Validation on every draft: no like or subscribe requirement (B-07), no URLs, no contact data.
- The draft language follows the B-06 cascade. The model is told which language to write in, and it never translates freely into the commenter's language.
- Model names are configuration per provider, with current defaults (R-29).
- Training risk: the Gemini API free tier may use content to improve Google's products. That conflicts with B-07. Decision: Q-13.
- The Privacy Policy must disclose that comment text is sent to the AI provider the creator chose.

**R-11 Keyword matching (Medium).** "Contains the whole word" produces false positives ("this guide was useless"). Proposal:
- Default mode "keyword-led": after Unicode NFKC normalization, case folding and stripping emoji and punctuation, the comment equals the keyword or an alias, or starts with it, or is at most 6 words and contains it.
- "Contains anywhere" is an opt-in per campaign.
- A keyword must be unique per channel among active campaigns whose video scopes overlap, so there are no collisions.
- Decision: Q-10.

**R-23 Rate limit defaults (Medium).** The SPEC has no numbers. Proposal: at most 30 replies per hour per channel and 150 per day per video. The creator can set lower values (Q-11).

**R-24 Bulk approval (Medium).** With volume, creators need "Approve selected" over visible drafts. It is still a human approval of each shown draft, and there are no auto-approve rules (Q-12).

**R-28 Language detection (Low).** Short comments ("GUIDE") cannot be detected reliably. Anything below a confidence threshold falls through to the creator's default language. Use `franc-min` or equivalent.

**R-29 Model names (Low).** "Claude Haiku", "gpt-4o-mini" and "Gemini" become per-provider configuration with defaults, not hardcoded values.

**R-19b Manual fallback (Medium).** The "Copy reply and open comment" button opens `https://www.youtube.com/watch?v={videoId}&lc={commentId}`. The app cannot verify a manual post without spending quota, so the creator clicks "Mark as posted", which sets the status to `manual_sent`. Clicks on the reply's tracked link then prove it was posted.

### Product and ops

**R-21 Headline edge cases (Medium).**
- Founding (97 USD/year): "Your subscription was $8.08 ($97/year)."
- Free and internal plans: the second sentence is omitted.
- Enterprise: price label from the plan row.
- Decision: Q-09.

**R-22 Owner admin (Medium).** "Granted manually" (`ghl_affiliate_free`), suspend and unsuspend, the capacity gate and the quota view need an owner console. Proposal: `/admin`, limited to the emails in a new `ADMIN_EMAILS` env var (Q-21).

**R-16 Audit my channel (Medium).**
- Following description links from the server is an SSRF risk. Block private and link-local IPs, limit to 3 redirects, 5 s timeout, 1 MB response cap.
- Protect the public form with Cloudflare Turnstile (free) plus the IP rate limit.
- Classification (questions, buying intent) is rule-based with no LLM, so it costs nothing and gives the same result every time (Q-18).

**R-25 Observability and backups (Low).** Add an optional `SENTRY_DSN`. Railway Postgres backups must be enabled (check in Phase 2). A worker heartbeat row plus an alert email if the heartbeat stops.

**R-20b Encryption and tenancy (Medium).**
- Ciphertext carries a key version prefix so `ENCRYPTION_KEY` can be rotated.
- Every query is scoped by `account_id` in the data layer, with tests proving cross-account reads fail.

**R-27 Cleanups (Low).** Covered in the R-06 table (`accounts.founding`, `plans.seats_used`).

**R-31 Hosted fallback opt-in (Low).** Served on the customer's link host (their own domain when present). The consent checkbox is never pre-checked (D-08).

**R-33 Docs (Low).** Fix the PRD "7 days" trial wording (D-37). Done in docs/PRD.md with this phase.

## 3. Decisions needed from the owner

Each question has a recommendation. Answering "all recommendations accepted" records them all. The ones marked **input needed** cannot be defaulted.

| ID | Question | Recommendation | Needed before |
| --- | --- | --- | --- |
| Q-01 | Product name and domain | **Input needed.** Decide before Phase 5 goes live. Until then: Railway domain, OAuth Testing mode. | Phase 5 go-live |
| Q-02 | Capacity policy before the quota extension | Poll only channels with active campaigns. D-27 tiers as targets, stretched by the global budget. 50% reply reserve. Onboarding gate at 30 active channels with a waitlist. Submit the extension right after the owner channel runs end to end. | Phase 4 |
| Q-03 | Monthly reply caps and channel limits per plan (pre-extension, stored as data, raised later) | standard_monthly 100, founding 100, ghl_affiliate_free 50, trial 20 in total, internal budget only, enterprise own quota. Channel limit 1, enterprise and internal configurable. | Phase 3 |
| Q-04 | Inbound auth | Bearer secret plus idempotency on (event, external_id) for provisioning and inbound hooks. HMAC verified when present. GHL Marketplace webhooks verified with Ed25519. | Phase 3 |
| Q-05 | Revenue source of truth | One revenue source per account. Others only mark buyers. | Phase 6 |
| Q-06 | GHL revenue signal | GHL payments first, won opportunity value as an option, buyer tag counts a buyer without revenue. | Phase 6 |
| Q-07 | Recurring payments | Each payment attributed if within 180 days of the last touch. | Phase 7 |
| Q-08 | Currency | Account reporting currency. Others listed separately. No FX. | Phase 7 |
| Q-09 | Headline for annual and free plans | Monthly equivalent for annual plans. Second sentence hidden for free and internal. | Phase 7 |
| Q-10 | Keyword match default | "Keyword-led" default, "contains anywhere" optional. | Phase 4 |
| Q-11 | Rate limit defaults | 30 per hour per channel, 150 per day per video, creator can lower. | Phase 4 |
| Q-12 | Bulk approval | Allow "Approve selected". No auto-approve. | Phase 4 |
| Q-13 | AI providers and training risk | Anthropic and OpenAI at launch. Gemini only with a paid-tier confirmation. Disclosure in the Privacy Policy. | Phase 4 |
| Q-14 | Commenter dedupe beyond 30 days | Keyed HMAC of the author channel id, legal review in Phase 12. | Phase 4 |
| Q-15 | Cloudflare setup | brand.tld DNS on Cloudflare once the domain exists. **Input needed:** a spare test domain you already own for the Phase 2/5 spike, or buy one (about 10 USD per year). | Phase 5 (spike: Phase 2) |
| Q-16 | Trial mechanics (D-37) | Trial runs in GHL. `trial_started` provisioning event. Trial reply cap 20. **Input needed:** does the founding offer also get the 14-day trial? Recommendation: no. | Phase 3 |
| Q-17 | Phase plan changes (R-15) | Accept (a) to (e). | Phase 2 |
| Q-18 | Audit classification | Rule-based, no LLM. Turnstile on the form. | Phase 9 |
| Q-19 | Which comments trigger | Top-level comments only. | Phase 4 |
| Q-20 | Founding seat cap | GHL stops selling. App never rejects a paid purchase and alerts at 90 and 100. | Phase 3 |
| Q-21 | Owner admin console | `/admin` limited to `ADMIN_EMAILS`. | Phase 3 |
| Q-22 | Leftover 02 question: GHL custom domain DNS fingerprint | **Input needed:** still open? If yes, I verify it during Phase 9 (stack detection). | Phase 9 |

## 4. Verified facts used in this review

- commentThreads.list: 1 unit per call, `maxResults` 1 to 100, `allThreadsRelatedToChannelId` and `searchTerms` supported, no deprecation note (Google YouTube Data API docs, commentThreads/list).
- PubSubHubbub: topic `https://www.youtube.com/feeds/videos.xml?channel_id=...`; the lease is capped at 432,000 s (5 days); notifications also fire on title and description updates (YouTube push notifications guide and hub behaviour reports).
- Cloudflare for SaaS plans: 100 hostnames included on Free, Pro and Business; 0.10 USD per additional hostname; max 50,000; the zone must be on Cloudflare; custom origin server available on Free, Pro and Business since 2025-05; Origin Rules support a Host header override (Cloudflare docs).
- GHL Custom Webhook workflow action: auth options Bearer, API key, Basic, OAuth2 or custom headers; no body signing. GHL Marketplace webhooks are signed with Ed25519 in `X-GHL-Signature`; legacy `X-WH-Signature` deprecated on 2026-09-01 (HighLevel support and developer docs).
- Google OAuth Testing mode: max 100 test users, refresh tokens expire after 7 days (Google OAuth documentation, known behaviour; recheck at verification time).
