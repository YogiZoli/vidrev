# Decisions

Source of truth: Drive doc "02 C2C SaaS Döntési napló" (last updated 2026-09-24/25), translated to English. Only the content above that doc's ARCHIVE section is included. On conflict, the 02 Decision log wins over 04 PRD and 05 SPEC; within 02, a later decision wins over an earlier one.

Sections:

1. Valid decisions D-01 to D-37 (owner decisions from 02)
2. Build brief decisions B-01 to B-09 (owner instructions given to Claude Code on 2026-09-25)
3. Proposals CC-xx (picked by Claude Code where something was ambiguous; pending owner approval)
4. Open questions

Status column: **valid** = applies as written; **refined** = still valid, a later decision adds detail; **superseded** = replaced by the named decision, kept only for traceability.

## 1. Valid decisions (02)

| ID | Decision | Reason | Status |
| --- | --- | --- | --- |
| D-01 | Positioning: a CRM-independent product, "See which video makes money from your comments." GoHighLevel users are the entry segment. | The total market is about 6x larger than the GHL segment; inside GHL the path to the first sale is shortest. | valid |
| D-02 | Branded, tracked URL into the user's own system. The link leads to the creator's own opt-in page with a tracking id, which the form stores in a hidden field. Link domain: the product's short domain by default, CNAME on the user's subdomain (e.g. go.userdomain.com) at Pro level. A hosted resource page is only a fallback. | Revenue attribution depends on it; the user's own domain also protects against spam filtering. | refined by D-28, D-33 (user's own domain is now the default for everyone, go.brand.tld is the fallback) |
| D-03 | Universal outbound webhook per event (`comment_matched`, `reply_posted`, `link_clicked`, `opt_in`, `purchase`), HMAC-signed JSON, plus a common tag scheme (`c2c`, `c2c_kw_<keyword>`, `c2c_vid_<videoId>`). | One build opens the product to every CRM (n8n, Make, Zapier, HubSpot, custom servers). | valid (SPEC adds `c2c_buyer`) |
| D-04 | Attribution by email. Email, consent and the campaign/video id live in the user's own system while consent is valid. YouTube API data (commenter channel id, comment) must be refreshed every 30 days (1 unit per 50 comments) or deleted. | Purchases after 90 days remain attributable, and the policy is respected. | valid |
| D-05 | Only real metrics: clicks, subscribers, buyers (unique), revenue (sum), conversions per video and keyword. Report headline: "This month your comments made $X. Your subscription was $Y." | This is the purchase justification; estimated values are not credible. | valid |
| D-06 | Moat: revenue attribution, plus a data advantage (benchmark), switching cost (historic attribution data) and Audit my channel as the entry point. Follow-up channels depend on the CRM and are an advantage only inside GHL. Time advantage is not a moat. | With a new app, domain and verification, the existing approval head start is lost. | valid |
| D-07 | Integration order: GHL won opportunity and buyer tag read-back, then Stripe, then Zapier, Make, n8n, then Gumroad, Kajabi, Teachable, Thinkific, Lemon Squeezy, ThriveCart. PayPal, Mailchimp, HubSpot only on request. | Stripe covers many platforms; Kit and Mailchimp are lead destinations, not revenue sources. | valid (note: "GHL integration is done" in 02 refers to the legacy app; it must be built fresh here per D-14, D-30) |
| D-08 | Resource email fallback for users without a CRM (Resend or Postmark): the app delivers the lead magnet; marketing consent is separate and never pre-checked. | Entry option for users who have no CRM yet. | valid (Resend chosen, B-03) |
| D-09 | Quota: separate GCP project per use case (customer replies, Audit my channel, research). Quota audit for 100,000 units after the first paying customers; channel-level listing (`allThreadsRelatedToChannelId`); adaptive polling (0-48h: 1-2 min, 2-14 days: 5 min, over 14 days: 15-30 min). | Quota cannot be bought; a reply (50 units) is the main cost, reading is cheap. | polling timings superseded by D-27; project rule refined by D-31, D-34 |
| D-10 | Audit my channel is the free lead magnet and the purchase entry point. | Proof first, inbound, same engine as the 03 research. | valid |
| D-11 | Drive document structure: 00 Index, 01 facts, 02 decisions, 03 research, 04 PRD and roadmap. Valid content on top, ARCHIVE below. Old versions in the "_Régi verziók" subfolder. | Token friendly. | valid (docs only, no code impact) |
| D-12 | Research method: LLM-free fingerprint research with a separate `c2c-market-research` GCP project and API key, no proxy, on the local machine. | Cheap, fast, does not touch the product quota. | valid (not part of this codebase) |
| D-13 | Owner entity: Wyoming LLC (not formed yet). | | valid |
| D-14 | A completely new codebase in a new private GitHub repo; the legacy C2C app and its users are separate. | | valid |
| D-15 | Hosting: Railway, separate project. | | refined by D-29 |
| D-16 | Launch via inbound: own organic video traffic plus the product's own comment CTA mechanism to build the email list and the first buyers. | | valid |
| D-17 | Launch language: English UI; reply language comes from creator-approved templates. | | refined by B-06 |
| D-18 | Domain architecture: brand and billing domain in GHL, the app on a separate domain, tracked links on a separate short domain. | | superseded by D-19, then D-28 |
| D-19 | brand.tld (GHL: landing, checkout, Privacy, Terms), app.brand.tld (app, Railway), brand.link (tracked links). Thanks to the subdomain, one verified domain is enough for Google OAuth. | | link domain superseded by D-28, D-33 |
| D-20 | No lifetime plan. | | valid |
| D-21 | `ghl_affiliate_free` plan: free app access if the user pays for GHL through the owner's affiliate link. | | valid |
| D-22 | A free GHL Marketplace connector app for one-click connection; the SaaS stays platform-independent. | | valid |
| D-23 | Forbidden in the product name: "YouTube", "YT", "Tube", "GHL". | | valid |
| D-24 | Founding offer: 97 USD per year, renewal price locked for life, for the first 100 buyers. | | valid |
| D-25 | Approval-only sending: AI draft (with the user's own AI key), manual approval, then sending through the API; no automatic posting. If the daily quota runs out, manual fallback: a "Copy reply and open comment" button (0 units). | | valid |
| D-26 | The new SaaS replaces the legacy GHL C2C app. The legacy app keeps running frozen (no new development) until the new one reaches functional parity on the owner's own channel, then it is retired. | | valid |
| D-27 | Quota strategy, independent of quota approval: (1) channel-level polling, so watching old videos costs no extra quota; (2) new uploads detected without quota through YouTube push notifications (PubSubHubbub) or RSS, which triggers fast polling for 48h; (3) activity-based rhythm: fresh video 2 min, normal 15 min, quiet channel 60 min; (4) daily quota budget with a reserve for replies, a transparent queue with estimated send time and an open reference to the YouTube quota, plus the manual fallback; (5) per-plan monthly reply cap; (6) the quota audit is an upside, not a dependency. | | valid |
| D-28 | One domain is enough: brand.com (GHL), app.brand.com (app), go.brand.com (tracked links). A separate .link domain is optional, later. | | valid; go.brand.com is the fallback only (D-33) |
| D-29 | Infrastructure: everything in the Railway project `c2c-saas` (app, worker, Postgres); no Supabase, no Upstash, no Redis. | The legacy app hit free tier limits on both. | valid |
| D-30 | Decisions, quota and architecture solutions of the legacy C2C app are NOT guidance and NOT patterns for the new app. | | valid |
| D-31 | Quota: multiple GCP projects for the same purpose are prohibited (YouTube Developer Policies). Legal tools: channel-level polling, push notifications, reply scheduling that uses the daily budget evenly (what does not fit today goes first tomorrow), transparent queue, per-plan caps, a separate project only for a separate use case (Audit my channel), quota audit. | | valid |
| D-32 | Enterprise plan: BYOK, the customer's own GCP project and quota; no on-premise. | | valid |
| D-33 | Tracked links on the USER'S OWN domain (e.g. go.userdomain.com) are mission critical: CNAME to the link service, automatic TLS (Cloudflare for SaaS, Custom Hostnames); go.brand.com is only a fallback. Google verification concerns only the app domain, not the user's link domain. | | valid |
| D-34 | Audit my channel gets its own separate GCP project (different use case). | | valid |
| D-35 | Quota extension has no official deadline (reports range from days to months; a typical first approval is 50,000 to 100,000 units per day). The legacy app's 1-day approval was OAuth verification, not a quota extension. | | valid (planning fact) |
| D-36 | Stack (approved 2026-09-25): TypeScript + Next.js + Postgres, no Redis. Speed: the UI never waits on an external API; every YouTube and GHL call runs in the worker. | | valid |
| D-37 | Pricing: the 29/49/99 USD draft is rejected. 14-day trial with card required. No forever-free plan (the free entry point is Audit my channel). The standard monthly price is not decided yet and stays configurable. | | valid |

## 2. Build brief decisions (owner, 2026-09-25)

These come from the owner's build brief to Claude Code. They add detail to the 02 decisions and do not contradict them.

| ID | Decision |
| --- | --- |
| B-01 | UI vocabulary: Comment, Subscriber, Buyer, Revenue. Avoid "lead" and "client" in the UI. |
| B-02 | Target: active owner-creators who already sell their own offer and upload regularly; entry segment GHL users in coaching, agency, real estate and fitness niches. |
| B-03 | Stack details: Next.js App Router, Drizzle ORM, pg-boss worker, Resend, Vitest. Railway services `web` and `worker` plus Postgres. |
| B-04 | Billing is not in the app. Checkout lives in GHL and calls a signed provisioning webhook (purchase: activate and send magic link; cancel or failed payment: suspend). |
| B-05 | Plans are data: `standard_monthly` (price not decided, configurable), `founding` (annual, 97 USD/year, renewal locked for life, first 100 buyers), `ghl_affiliate_free` (manual or by webhook), `enterprise` (BYOK, price later), `internal`. 14-day trial with card (D-37). No forever-free plan, no lifetime plan. |
| B-06 | Reply language cascade: the commenter's language only if an approved template exists in that language, else the creator's default language (set manually), else English. Never post an unapproved machine translation. UI in English only. |
| B-07 | YouTube compliance: scopes `youtube.force-ssl` plus `openid email profile` only; reply only to explicit keyword comments; varied templates; per-video and per-hour limits; never require like or subscribe; store YouTube API data max 30 days or refresh every 30 days; never use Google user data for model training. |
| B-08 | Attribution default: last touch within 180 days; refunds reduce revenue. (Resolves SPEC open decision 3.) |
| B-09 | Legal pages are drafts marked "DRAFT - needs legal review" until the Wyoming LLC exists. |

## 3. Proposals (Claude Code, pending owner approval)

| ID | Proposal | Why |
| --- | --- | --- |
| CC-01 | The env var for the fallback link host is `LINK_FALLBACK_BASE_URL` (build brief), replacing `LINK_BASE_URL` in the SPEC. User custom hostnames are stored in the database, not in env. | The brief is the newest owner instruction and the name matches D-33 (fallback only). |
| CC-02 | The tracking parameter and hidden field are both named `c2c_tid`. The `?c2c=v8k2x` in D-02 is read as an illustration. | SPEC sections 8 and 9 and the GHL connector already use `c2c_tid`; one name avoids broken attribution. |
| CC-03 | Custom hostname env vars: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`, `CUSTOM_HOSTNAME_CNAME_TARGET`. | Needed for D-33; not listed in the SPEC env list. Details to be confirmed in the Phase 1 review. |
| CC-04 | The SPEC phrase "same approach as the legacy C2C app" (AI drafts) is dropped from docs/SPEC.md. | D-30: the legacy app is not a reference. The feature itself (user's own AI key) stays. |
| CC-05 | 04 PRD items superseded by later decisions (auto mode, Starter/Pro/Scale tiers, "built on the existing Counter", adaptive polling timings) are marked in docs/PRD.md, not silently rewritten. | Keeps the PRD faithful to the Drive source while pointing to the valid decision. |
| CC-06 | Extra env vars not in the SPEC list: `AUTH_SECRET` (sessions, magic links), `WEBSUB_SECRET` (PubSubHubbub verification), `EMAIL_FROM` (Resend sender). | Required by features the SPEC already describes. |

## 4. Open questions

The Phase 1 review adds owner questions Q-01 to Q-22 in [docs/SPEC-REVIEW.md](docs/SPEC-REVIEW.md) section 3. Accepted answers are recorded here as decisions at the start of Phase 2.

1. Product name and domains (env vars until decided; D-23 naming limits apply).
2. `standard_monthly` price: not decided, configurable (D-37). The 04 PRD tiers (29/49/99 USD) are obsolete.
3. Carried over from 02: exact DNS fingerprint of GHL custom domains (for stack detection in Audit my channel). See Q-22.
4. Carried over from 02: "What does the legacy C2C Counter measure?" is moot for this codebase per D-30 and will not be investigated.

## 5. Owner answers to the Phase 1 review (2026-09-25)

| Question | Answer |
| --- | --- |
| Q-04 Inbound auth | **Accepted:** Bearer secret in a header plus idempotency on (event, external_id); HMAC verified when present. |
| Q-16 Founding trial | **No.** The founding offer has no trial. The 14-day trial (D-37) applies to `standard_monthly`. |
| Q-17 (a) Compliance timing | **Accepted:** Privacy/Terms drafts, OAuth verification pack and quota extension request move to right after Phase 5. |
| Brand domain | The owner will buy the brand domain at Cloudflare (registrar and DNS). |
| Q-15 Test domain | Pending. The Cloudflare for SaaS spike needs a domain on Cloudflare: either the brand domain (once bought) or a spare test domain. |
| D-38 Tracked links on the user's own subdomain, maximally automated | **Approved by owner (2026-09-25).** Supersedes the earlier "no DNS" proposal (withdrawn: it lost click measurement). Confirms D-33: (1) every reply link runs on the creator's own subdomain (e.g. go.userdomain.com) through a redirect on our side, so clicks are always measured; (2) Cloudflare for SaaS (Custom Hostnames) on the owner's Cloudflare account only; the user needs no Cloudflare account and their DNS can be anywhere; (3) onboarding automation: the domain is pre-filled from the campaign destination URL or the connected CRM, the DNS provider is detected by an NS lookup, Domain Connect one-click "Allow" is built from Phase 5 and goes live per DNS provider as each provider approves our template (requires the final brand domain); providers without Domain Connect get a provider-specific guide with the single CNAME, a "send to my web person" email and automatic verification; (4) go.brand.tld fallback only for users who have no domain; (5) cost: 100 custom hostnames included, then 0.10 USD per hostname per month; included in every plan (no separate tier needed for cost reasons). |
| Q-05 Revenue source | **Owner decision:** store every purchase event from every connected source (GHL, Stripe, webhooks), keep all raw numbers, but count revenue only once: duplicates of the same sale across sources are linked to one canonical purchase and never added twice. |
| Q-06 GHL revenue signal | **Accepted:** only money actually paid counts (GHL payments: orders, transactions, invoices). Won opportunity values are not revenue. A buyer tag without an amount counts a buyer with revenue "not reported"; never estimated. |
| Q-07 Recurring revenue | **Owner decision (core principle):** recurring revenue counts for as long as the subscription is active. The 180-day last-touch window applies to the first purchase; every later payment of that same subscription is attributed to the same video and keyword for its whole life. A separate new purchase by the same buyer needs its own touch within 180 days (Claude's reading, to confirm). |
| Q-08 Currency | **Owner decision:** the reporting currency is the currency of the connected revenue source (CRM or Stripe); without a connection it is configurable, default USD. Original amounts and currencies are stored. |
| Q-09 Report headline | **Owner decision, replaces the D-05 sentence:** show attributed revenue this month AND lifetime, the recurring part of it, and the subscription cost as a percentage of attributed revenue (e.g. "Your subscription cost 0.13% of what your comments made"). Real numbers only; the percentage line is omitted on free plans or when revenue is zero. |
| Tracking id capture (proposal CC-07) | Pending: the redirect appends `c2c_tid` plus standard UTM parameters (`utm_source=c2c`, `utm_medium=comment`, `utm_campaign=<keyword>`, `utm_content=<tid>`) so any form tool or CRM that stores UTMs captures the id without extra setup; a hidden `c2c_tid` field remains the universal fallback. Platform independent, not GHL specific. |
| Q-12 Bulk approval | **Owner decision: no.** No "approve selected" or any batch approval; every reply is approved individually (spam risk and Google review risk). |
| Q-13 AI providers | **Owner: Gemini (including the free tier) must be supported; it is the cheapest option.** Anthropic and OpenAI supported as well. Open point: free-tier Gemini terms allow Google to use submitted content to improve its products, which is a risk for the Google OAuth / YouTube API compliance review (Limited Use). Re-check before the verification submission (after Phase 5). |
| Q-14 Commenter dedupe | **Owner decision: no dedupe of commenters.** Returning commenters are likely buyers; every new keyword comment gets its own draft. No commenter hash is stored. The approval queue may show "already replied to this person on this video" as information only (within the 30-day data window), never as a block. |
| Q-20 Founding seat cap | **Accepted:** GHL stops selling at 100; the app never rejects a paid purchase and emails the owner at 90 and at 100. |
| Q-21 Owner admin | **Accepted:** `/admin`, limited to the emails in `ADMIN_EMAILS` (grant `ghl_affiliate_free`, suspend accounts, view quota). |
| Q-10 Keyword match (2026-09-25) | **Owner decision:** a comment matches when it contains the keyword anywhere, as a whole word, case-insensitive (after normalization). No "starts with" or "short comment" rule. False positives ("this guide was useless") are filtered by the creator in the approval queue. Open: handling of comments that contain several keywords (proposal: one reply per comment, see below). |
| Q-19 Trigger scope (2026-09-25) | **Accepted:** only top-level comments trigger drafts. Replies inside a comment thread (nested under a top-level comment) never trigger. |
| Q-17 (b) GHL Marketplace app (2026-09-25) | **Accepted and verified:** one app, created as Private in Phase 6 (cap: 5 agencies for private apps created after 2025-11-18), switched to Public via "Start Public review" in Phase 10. The product stays a standalone SaaS: billing runs in the owner's GHL checkout, the Marketplace app is a free connector only. |
| Q-17 (c) Data retention (2026-09-25) | **Owner rule, applies to every future phase and session.** (1) YouTube data from the creator's OAuth (comment text, commenter names and channel ids, video and channel titles, reply ids) is deleted or refreshed within 30 days. YouTube API Developer Policies III.E.4 do not allow consent to extend this for comment data. (2) First-party data (replies we sent, clicks, opt-ins, purchases, aggregate counts) is kept while the account is active. (3) Disconnecting YouTube deletes all YouTube-derived data within 7 days (policy III.E.4); closing the account or uninstalling deletes all data of that account. (4) The Privacy Policy and Terms state (1) to (3) prominently, as a separate section, because the Google OAuth review checks it. (5) The retention job ships in Phase 4. |
| Q-17 (d) Cloudflare spike | **Accepted:** runs once the brand domain exists. |
| Q-17 (e) Stripe | **Finding (2026-09-25):** Stripe Connect `read_only` OAuth is limited to legacy extensions and Standard accounts are deprecated for new integrations. Phase 8 uses a Stripe App or a creator-provided restricted read-only key instead; decided at the start of Phase 8. |
| Q-22 GHL DNS fingerprint | **Closed:** Phase 9 reuses the stack signatures of the 03 research (D-12). |
| Q-02 Capacity (2026-09-25) | **Accepted:** a channel is "active" when it has at least one enabled campaign (a watched keyword) and its account is not suspended; only active channels are polled. Polling targets are stretched by the global budget. Daily reply reserve is stored as data, default **75%** (owner, 2026-09-25). Onboarding gate: all 100 founding buyers. Before the quota extension, API-posted replies are shared fairly and the rest go out through the zero-quota "Copy reply and open comment" fallback; the UI states honestly that this is YouTube's quota limit, not ours. Quota extension submitted as soon as the owner's channel runs end to end. |
| Q-03 / Q-11 Reply caps and limits (2026-09-25) | **Owner decision:** every plan (standard_monthly, founding, trial) gets 300 replies per month plus a safety ceiling of 30 replies per channel per day (spam protection, not pricing). The trial gets exactly the same limits as paid plans; marketing copy highlights this. 1 channel per account, configurable for enterprise and internal. Enterprise follows its own quota. ghl_affiliate_free gets the same 300 (owner, 2026-09-25). |
| CC-07 Tracking id capture (2026-09-25) | **Accepted, all three layers:** (1) the redirect appends UTM parameters (`utm_content=<tid>`) and `c2c_tid`; (2) a hidden `c2c_tid` form field; (3) the redirect on the creator's own subdomain sets a first-party cookie on the registrable domain and an optional script on the opt-in page fills the hidden field from it. No match without a tracking id or email; never estimated. |
| Q-10b Several keywords in one comment (2026-09-25) | **Accepted by owner:** one reply per comment. Each keyword has an intent level HOT, WARM or COLD (one dropdown, default WARM). The highest level wins (HOT > WARM > COLD); on a tie, a campaign scoped to that video beats a channel-wide one, then the keyword appearing first. The approval card shows the other matched keywords and lets the creator switch. |
| Q-13b Gemini location rule (2026-09-25) | **Clarification:** the Gemini free-tier EEA/UK/CH rule depends on where the customer who owns the key is, not on the owner or the company. Target markets are mainly US and Southeast Asia, so most customers need a billing-enabled key. Superseded by Q-13c. |
| Q-13c Default AI key (2026-09-25) | **Owner decision, supersedes "user's own key only" (brief, SPEC 7 step 4):** every account drafts with the owner's platform Gemini key by default, on a billing-enabled GCP project so Google does not train on the data (a free-tier key of a US company would). Customers may switch to their own Anthropic, OpenAI or Gemini key; an own Gemini key needs billing enabled unless the customer is in the EEA, UK or Switzerland. The commenter's name is never sent to any AI. The exact cost per draft is checked at the start of Phase 4. The platform key lives in its own GCP project, never the YouTube app project. |
| D-31b Reply sending (2026-09-25) | **Owner decision, amends D-31:** an approved reply is sent immediately when it fits today's reply budget (speed to lead matters); only replies above the budget wait and go out first after the midnight PT reset. No even spreading across the day. |
| R-35 Reporting and retention features (2026-09-25) | **Owner approved, scheduled in Phase 7 unless noted:** (1) reply template test: clicks and buyers per template, also grouped by keyword intent HOT, WARM, COLD; (2) approval time vs conversion from real data (speed to lead); (3) weekly email "this week your comments made $X" (Phase 7); (4) anti-churn: a permanent ROI line ("your comments made 14x your subscription"), instant milestone notifications (first click, first subscriber, first buyer), the cancel page shows attributed revenue and that measurement stops, a value recap email before the founding renewal; tracked links keep redirecting after cancellation (never held hostage), only measurement stops; (5) mobile approval: an email notification when drafts are waiting, linking to a mobile-friendly approval queue (Phase 4), web push later. |

## 6. Phase 3 implementation choices (proposals, 2026-09-25)

| ID | Choice | Why |
| --- | --- | --- |
| P3-01 | Provisioning payload adds `subscription_id`. A cancellation or failed payment suspends only when it matches the subscription that activated the account. `external_id` is the id of the occurrence (order, transaction, invoice), so renewals and reactivations are not dropped as duplicates. | An upgrade in GHL usually cancels the old subscription; without the guard it would suspend the new plan. |
| P3-02 | A rejected provisioning event (unknown plan code, founding trial) returns 422, emails the owner and is not stored, so a resend after fixing the workflow is processed. | Paid purchases must never be silently lost (Q-20). |
| P3-03 | Suspended accounts can still sign in and see their data; polling, sending and new channel connections are blocked. | Keeps first-party reports visible (R-26) and supports reactivation. |
| P3-04 | The magic link opens a page with a "Continue" button; the token is consumed only on POST. | Mail scanners (Outlook, Gmail) prefetch links and would burn single-use tokens. |
| P3-05 | The OAuth code exchange runs in the web callback (codes expire in minutes); resolving the channel (`channels.list`, 1 unit) runs in the worker. | Keeps the rule that YouTube API calls run in the worker. |
| P3-06 | Owner accounts from `ADMIN_EMAILS` are seeded on the `internal` plan at every start (idempotent). | The owner can sign in before any checkout exists. |
| P3-07 | A YouTube channel can be live in only one account (unique index). Reconnecting the same channel in the same account replaces the old grant. | Prevents double polling and double replies. |

## 7. Phase 4 implementation choices (proposals, 2026-09-25)

| ID | Choice | Why |
| --- | --- | --- |
| P4-01 | A campaign only drafts replies to comments published after it was created; the first poll of a channel starts at its oldest enabled campaign. | Enabling a keyword must never flood the queue with old comments. |
| P4-02 | Quota units are charged in `quota_ledger` before each call under an advisory lock. Reads (polls, video titles, retention refreshes) may use only 25% of the day; replies may use everything left. Poll intervals stretch by one global factor (capped at 96x) when active channels need more reads than the budget allows (keeping 20% headroom). | D-27, D-31, Q-02; YouTube charges failed calls too. |
| P4-03 | One poll reads at most 5 pages (500 new comments); older new comments beyond that are skipped and logged. | Bounds quota per poll; far above the target channel size. |
| P4-04 | Only matching comments are stored; nothing else from a poll is kept. | Data minimization for the Google review. |
| P4-05 | Language detection (franc) runs only on comments of 20+ characters; shorter ones use the channel default. | Short comments are detected wrongly; B-06 then falls back safely. |
| P4-06 | The platform AI default is `gemini-3.1-flash-lite` (checked 2026-09-25: 0.25 USD / 1M input, 1.50 USD / 1M output tokens, about 0.0003 USD per draft, about 0.09 USD per account per month at 300 drafts). Own keys: OpenAI `gpt-5.4-nano`, Anthropic `claude-haiku-4-5` defaults, overridable per account. Invalid AI output (missing link twice, engagement bait) falls back to the least recently used approved template, else "Here you go: {link}" for the creator to edit. | Q-13c; model names are configuration. |
| P4-07 | Template rules: `{link}` exactly once, max 1000 characters, no like/subscribe/bell requests (EN, HU, ES, FR/DE patterns). Checked on save, on every AI draft and on every approval. | Brief: never require like or subscribe. |
| P4-08 | Plan caps count replies approved in the Pacific month and day, including queued and hand-posted ones. Drafts over the monthly cap are stored as `skipped` with the reason; the daily ceiling blocks approval with a message and the manual fallback stays available. | Q-03 / Q-11; one quota calendar everywhere. |
| P4-09 | "Drafts are waiting" email at most once per hour per account. | R-35 mobile approval without spamming. |
| P4-10 | `replies.youtube_video_id` is kept as first-party data (the video we replied on) for per-video reporting; comment text, commenter names and ids, video titles and reply ids are deleted after 30 days or at disconnect. Drafts not approved within 30 days become `expired`. | Q-17 c; Phase 7 reports per video. **Accepted by owner (2026-09-25).** |
| P4-11 | Retention deletes old comments rather than refreshing them (the SPEC allows either). | The comment is only needed while the draft is open. |

## 8. Owner answers after Phase 4 (2026-09-25)

| Topic | Answer |
| --- | --- |
| P4-10 Video id on sent replies | **Accepted.** |
| Data principle (applies to every phase) | **Owner rule:** keep as much first-party data as possible, detailed and complete (every event, timestamp, status change, reply text, keyword, intent, language, draft source, approval time, click, opt-in, purchase). Nothing is left out; data that turns out to be unneeded can be deleted later or simply not shown. Limit: YouTube API data (comment text, commenter names and ids, video and channel titles, reply ids) still follows the 30-day rule (Q-17 c, YouTube API Developer Policies III.E.4); this principle cannot override it. |
| Platform Gemini key and WebSub secret | **Deferred** until the brand domain exists; the owner enables no billing before that. Until then drafts use the approved templates. When it is time, Claude gives click-by-click steps with paste-ready URLs (like the Phase 3 Google setup). |

## 9. Phase 5 implementation choices (proposals, 2026-09-25)

Brand domain: **vidrev.app** (owner, 2026-09-25), on Cloudflare. Brand site `vidrev.app`, app `app.vidrev.app` (later), fallback links `go.vidrev.app`, CNAME target `customers.vidrev.app`.

| ID | Choice | Why |
| --- | --- | --- |
| P5-01 | Two link kinds (R-07): one `reply` link per reply, minted when the draft is shown or sent; until posted it follows keyword switches and a newly live domain, then host, campaign and destination freeze. `static` links per campaign (channel-wide) and per campaign and video, for descriptions and pinned comments. Slugs: 7 characters, globally unique. | Comment-level data; a posted link must never move (changing it costs 50 units). |
| P5-02 | The redirect always goes to the campaign destination stored on the link (no open redirect). Links keep redirecting after campaign deletion and account suspension; suspended accounts are not measured (R-35). | Never hold creators' links hostage. |
| P5-03 | Every click is stored (first-party): tid, link, reply, campaign, video id, keyword, host, daily-salted ip hash, user agent and class, bot flag, country, referrer host. Bots get no tid. | Data principle (DECISIONS section 8); bot clicks must not steal attribution. |
| P5-04 | Click id `c2c_tid` is 10 characters; appended with `utm_source=c2c`, `utm_medium=comment`, `utm_campaign=<keyword>`, `utm_content=<tid>`. On the creator's own domain a 180-day first-party cookie is set on the registrable domain; `/c2c.js` fills `c2c_tid` fields from URL or cookie and stores it on the opt-in page's domain. | CC-07, all three layers. |
| P5-05 | Link traffic reaches Railway through Cloudflare with Host rewritten to the Railway domain and `X-Original-Host` carrying the real host; the app routes on that header (or on the fallback host directly). | R-03; Railway rejects unknown hosts. |
| P5-06 | One live custom domain per account, subdomains only (no apex), product domains reserved. Verification: DNS-over-HTTPS CNAME check plus Cloudflare custom hostname with HTTP DCV; live only when Cloudflare reports hostname and certificate active. Checked every minute for 15 min, every 10 min to 48 h, hourly to 14 days, then "not found" until Check now. Live domains rechecked daily; a broken one drops back so new links use the fallback. | D-38 automatic verification, without waiting on the creator. |
| P5-07 | "Send to my web person" is a prefilled `mailto:` link; the creator sends it from their own mail. | Nothing is sent on the creator's behalf. |
| P5-08 | Domain Connect: discovery on the first domain check; the button appears only when the provider already supports our template. Signed apply URLs when `DOMAIN_CONNECT_PRIVATE_KEY` is set. | D-38: built now, goes live per provider. |
| P5-09 | **Owner decision (2026-09-25):** the product name is `vidrev`, always lowercase, domain `vidrev.app`. Closes Q-01. | Owner. |
| P5-10 | Owner kill switch per account blocks links on the shared fallback host only (410); links on the creator's own domain keep working. | R-20. |
| P5-11 | **Owner request (2026-09-25):** Cloudflare for SaaS spend is capped in the app: at most `CUSTOM_HOSTNAME_LIMIT` (default 150) live custom domains across all accounts, so the bill stays at or below 5 USD a month (100 free, then 0.10 USD each). Over the cap, new domains are refused with an honest message, links use go.vidrev.app, and the owner is emailed. | Cloudflare has no hard spend cap. |
| P5-12 | The Free plan has no Origin Rule Host rewrite, so a Worker on route `*/*` forwards link traffic to Railway with `X-Original-Host` (`workers/vidrev-links.js`). Workers Free: 100,000 requests a day. | Replaces P5-05's origin and transform rules. |

## 10. Compliance timing (owner, 2026-09-25)

| Topic | Answer |
| --- | --- |
| Submission timing | Google OAuth verification and the YouTube quota request are submitted after the Wyoming LLC is formed (Northwest), so the Privacy Policy and Terms name the entity from the start. The EIN is not required by Google and is not waited for. Drafts are ready in docs/compliance/. |
| Product name | `vidrev`, lowercase, domain vidrev.app (P5-09). |
