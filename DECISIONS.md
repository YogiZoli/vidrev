# Decisions

Source of truth: Drive doc "02 C2C SaaS Döntési napló" (last updated 2026-09-24/25), translated to English. Only the content above that doc's ARCHIVE section is included. On conflict, the 02 Decision log wins over 04 PRD and 05 SPEC; within 02, a later decision wins over an earlier one.

Sections:

Later sections 5 to 15 record owner answers and the implementation choices of each phase.

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
| D-32 | Enterprise plan: BYOK, the customer's own GCP project and quota; no on-premise. | | on hold, direction open (Q-25) |
| D-33 | Tracked links on the USER'S OWN domain (e.g. go.userdomain.com) are mission critical: CNAME to the link service, automatic TLS (Cloudflare for SaaS, Custom Hostnames); go.brand.com is only a fallback. Google verification concerns only the app domain, not the user's link domain. | | valid |
| D-34 | Audit my channel gets its own separate GCP project (different use case). | | valid |
| D-35 | Quota extension has no official deadline (reports range from days to months; a typical first approval is 50,000 to 100,000 units per day). The legacy app's 1-day approval was OAuth verification, not a quota extension. | | valid (planning fact) |
| D-36 | Stack (approved 2026-09-25): TypeScript + Next.js + Postgres, no Redis. Speed: the UI never waits on an external API; every YouTube and GHL call runs in the worker. | | valid |
| D-37 | Pricing: the 29/49/99 USD draft is rejected. 14-day trial with card required (**trial paused by L-08**). No forever-free plan (the free entry point is Audit my channel). The standard monthly price is not decided yet and stays configurable. | | valid |

## 2. Build brief decisions (owner, 2026-09-25)

These come from the owner's build brief to Claude Code. They add detail to the 02 decisions and do not contradict them.

| ID | Decision |
| --- | --- |
| B-01 | UI vocabulary: Comment, Subscriber, Buyer, Revenue. Avoid "lead" and "client" in the UI. |
| B-02 | Target: active owner-creators who already sell their own offer and upload regularly; entry segment GHL users in coaching, agency, real estate and fitness niches. |
| B-03 | Stack details: Next.js App Router, Drizzle ORM, pg-boss worker, Resend, Vitest. Railway services `web` and `worker` plus Postgres. |
| B-04 | Billing is not in the app. Checkout lives in GHL and calls a signed provisioning webhook (purchase: activate and send magic link; cancel or failed payment: suspend). |
| B-05 | Plans are data: `standard_monthly` (price not decided, configurable), `founding` (annual, 97 USD/year, renewal locked for life, first 100 buyers), `ghl_affiliate_free` (manual or by webhook), `enterprise` (BYOK, price later), `internal`. 14-day trial with card (D-37, **paused by L-08**). No forever-free plan, no lifetime plan. |
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
| Q-14 Commenter dedupe | **Partly superseded by Q-23 (section 13): commenters are now recognised and kept as one Contact. The drafting rule below stays.** **Owner decision: no dedupe of commenters.** Returning commenters are likely buyers; every new keyword comment gets its own draft. No commenter hash is stored. The approval queue may show "already replied to this person on this video" as information only (within the 30-day data window), never as a block. |
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

## 11. Phase 6 implementation choices (proposals, 2026-09-25)

| ID | Choice | Why |
| --- | --- | --- |
| P6-01 | Outbound events go through an outbox (`outbound_deliveries`): one row per event and endpoint, delivered by a worker job right away and by the engine tick as a safety net. Retries after 1 min, 5 min, 15 min, 1 h, 3 h, 6 h and 12 h (the last one about 22 hours after the event), then the row is dead. Any non-2xx or network error is retried; 410 turns the endpoint off. `X-Signature: sha256=<hex HMAC-SHA256 of the raw body>` (the bare hex is accepted on the inbound side), `X-Event-Id`, `X-Event-Name`. | SPEC section 11 (retries for 24 hours); a lost job never loses an event; the prefix is what most receivers expect. |
| P6-02 | Event payloads add `campaign_id`, `intent`, `reply_id`, `source` and a ready `tags` list to the SPEC fields. They never contain comment text, commenter names or commenter ids. | YouTube API data does not leave the app (Q-17 c, Limited Use); tags let n8n, Zapier and Make apply the scheme without code. |
| P6-03 | Endpoints: public `https` only, private and metadata addresses refused when saved and again when connecting (DNS rebinding), redirects never followed, 10 s timeout, at most 5 per account, signing secret `whsec_...` shown on the page. Finished delivery logs are pruned after 30 days. | Creators supply the URLs; the worker must not be pointed at our network. Delivery logs are operational, the events themselves live in their own tables. |
| P6-04 | Inbound hooks: one token per account (`c2c_hk_...`, stored hashed for lookup and encrypted for display, rotatable), sent as bearer, `X-Hook-Token` or `?token=`; optional `X-Signature` HMAC with the token as key. JSON and form bodies, 64 KB, 120 requests a minute per account, 30 failed tokens a minute per address. A suspended account gets a 2xx with `ignored` and nothing is recorded. | Q-04 and R-05: form tools and GHL cannot sign; a 2xx stops senders from retrying forever. |
| P6-05 | Idempotency: an opt-in is one row per account, source, email and touch (`external_id`, else the tid, else "none"); a purchase is one row per account, source and `external_id`. A repeat of a purchase with `refunded_amount` records the refund; it never adds revenue. `consent_marketing` stays `null` unless the source says. | Retries and double submits are normal; consent is never assumed. |
| P6-06 | Amounts are integer minor units with a currency (zero and three decimal currencies handled); an amount without a currency is refused; nothing is converted. A purchase without an amount is a `buyer_marker` (revenue not reported). | Q-06, Q-08, never estimated. |
| P6-07 | The outbound `purchase` event carries campaign, video and keyword from the tid, else from the latest opt-in of that email in the 180 days before the purchase, and the `c2c_buyer` tag only when such a touch exists. This enriches the event only; the attribution rules and reporting are Phase 7. | B-08; an unrelated buyer is not a "c2c buyer". |
| P6-08 | GoHighLevel connector: location level, Private Marketplace app, scope list built in and overridable with `GHL_SCOPES`. Refresh tokens rotate, so a refresh happens under a row lock. A refused refresh marks the integration `error`, emails the creator once ("Reconnect") and stops its jobs. One location per account and one account per location. Disconnect and the uninstall webhook wipe the tokens. | HighLevel invalidates the old refresh token on every refresh; docs/SETUP-GHL.md. |
| P6-09 | GHL is read every 5 minutes: new contacts newest first (tracking id from the `c2c_tid` field, else `utm_content` of the contact's attribution; buyer tag), won opportunities hourly (a buyer, never revenue, Q-06), payments every run with a 90 day pass daily so refunds are seen. Marketplace webhooks (Ed25519 `X-GHL-Signature`, HighLevel's published key, overridable) only verify and queue; API calls run in the worker. A buyer tag or won opportunity adds no marker when that email already has any purchase. | Q-05, Q-06, D-36; polling is the floor, webhooks are speed. |
| P6-10 | GHL is one more target of the same outbox for `opt_in` and `purchase`: the contact is upserted with the `c2c_tid` field and the tags are added (additive endpoint, so the creator's other tags stay). Only contacts traceable to a comment (keyword present) are touched. HighLevel lowercases tags, so tags are labels, never the key for matching (tid and email are). | Reuses retries, idempotency and logs; never tags people we cannot trace. |
| P6-11 | The buyer tag read from GHL is configurable per connection (default `c2c_buyer`, empty disables). | Creators already have their own customer tags. |
| P6-12 | `comment_matched` fires when the draft is created (also for drafts skipped by the monthly cap); `reply_posted` when the reply is posted by the API or marked as posted by hand; `link_clicked` for measured, non-bot clicks, emitted after the redirect is decided. | Events must never slow a click or fail a reply. |
| P6-13 | The hosted opt-in fallback (SPEC section 9, D-08) is not part of Phase 6, which the brief limits to webhooks and GHL. Proposal: build it with the Resend resource email in Phase 7 or later, when a creator without any CRM appears. | Scope of the phase brief. |
| P6-14 | Several details of the HighLevel API can only be confirmed against a real location; they are listed in docs/SETUP-GHL.md section 5 with the single place to change each. | Built from the public OpenAPI files, tested against a fake. |

## 12. Phase 7 implementation choices (proposals, 2026-09-26)

| ID | Choice | Why |
| --- | --- | --- |
| P7-01 | Duplicates across sources (Q-05): a payment from another source with the same buyer (email or tracking id), currency and amount within 72 hours links to one canonical purchase, at most one row per source. Canonical source order: Stripe, then GHL, then the inbound webhook. The largest refund in a group counts once. Buyer markers are never merged; buyers are distinct people, so a marker never adds a second buyer or revenue. | Revenue counts once; a processor of record is the most exact source. |
| P7-02 | Touch: the purchase's own `c2c_tid` first (SPEC section 10), else the latest attributed opt-in of the same email; the touch must be within 180 days before the purchase (B-08), with 10 minutes of clock skew allowed after it. Clicks never touch by email (they carry none). | Checkout, CRM and form clocks differ; the checkout often creates the contact seconds after the payment. |
| P7-03 | Recurring (Q-07): every later payment with the same subscription reference follows the first payment's attribution for life; if the first payment was not from a comment, its renewals are not either. A separate new purchase needs its own touch within 180 days (Claude's reading of Q-07, to confirm). | Owner core principle. |
| P7-04 | Attribution is recomputed for the whole account after any new data; a late opt-in (CRM sync after the purchase webhook) can move a purchase to a closer touch. The outbound `purchase` event keeps the enrichment it had when sent (P6-07). | One deterministic function of stored first-party data. |
| P7-05 | Reports are snapshots per account and period (`report_snapshots`), rebuilt by the worker; every emitted event and every refund marks the account, the engine tick (1 min) queues the refresh, an hourly pass refreshes every account. The dashboard only reads. | D-36: dashboards read precomputed aggregates. |
| P7-06 | Periods are calendar days in the account's time zone (setting, default UTC): this month, last 7, 30 and 90 days, all time. | "This month" must mean the creator's month. |
| P7-07 | Definitions: comments = drafts created (every matched comment, also those skipped by the cap); replies = posted by API or by hand, by posting day; clicks = non-bot clicks; subscribers = distinct emails of opt-ins traced to a comment; buyers = distinct buyers (email, else tid) of attributed canonical purchases; revenue = net of attributed canonical payments in the reporting currency; recurring = payments of a subscription. Other currencies are listed separately, never converted (Q-08). | Real numbers only (D-05). |
| P7-08 | Headline (Q-09): this month and lifetime revenue, the recurring part, and the subscription as a share and a multiple of this month's revenue, using the plan's monthly price (annual / 12, R-21). Plans get `price_cents` and `price_currency` (founding 97 USD a year; `standard_monthly` stays empty until the price is decided, then set it in the plans table). Omitted without a price, at zero revenue or when the currencies differ. A trial shows the plan's price. No lifetime ROI: it would need the real billing history, which lives in GHL. | Never estimated. |
| P7-09 | Reporting currency follows the latest paid GHL (later Stripe) purchase unless the creator sets one in report settings. | Q-08. |
| P7-10 | Reply speed (R-35 item 2): replies posted in the period, grouped by time from draft to posted reply (under 1 h, 1 to 6 h, 6 to 24 h, over 24 h), with every click, subscriber, buyer and revenue they led to. Comment publish times are YouTube data and are not kept, so the draft time stands in for it. | First-party only (Q-17 c). |
| P7-11 | Template test (R-35 item 1): each reply is keyed as AI draft, its approved template, or the default reply; traffic from static links is its own row; each row shows the keyword intent. | Clicks and buyers per wording. |
| P7-12 | Emails: weekly summary on Mondays from 9:00 local time with the last 7 days, skipped for weeks without any activity, opt-out in report settings; milestone emails for the first click, subscriber and buyer, each recorded before it is sent (only the highest one when several are reached at once); renewal recap for yearly plans in the week that starts 14 days before the renewal, the renewal being a year after the latest paid provisioning event. Suspended accounts get none. | R-35 items 3 and 4. |
| P7-13 | `/app/cancel` shows attributed revenue and says that links keep working while measurement stops; it links to `BILLING_PORTAL_URL` when set (cancelling happens in the checkout, B-04). | R-35 item 4. |
| P7-14 | Not built in Phase 7: the hosted opt-in fallback (P6-13) stays open until a creator without a CRM appears. Video titles show only while stored (30-day rule), otherwise the video id with a watch link. | Scope; YouTube data rule. |

## 13. Contact identity and customer journey (owner, 2026-09-26)

This section is an **owner requirement, marked very important**. It applies to every phase from now on: Phase 8 (Stripe), the GHL connector, the inbound webhooks, reporting and everything later. If any other section, the SPEC or the code disagrees with it, this section wins, except where it says a question is still open.

### 13.1 The requirement, in the owner's words (translated)

In the earlier system a person who was only a Commenter (no email yet) and who then opted in through the tracked link, or who commented on a second video, **created a new Contact every time**. That must never happen again:

- A Commenter with no email is a Contact. When the comment is answered, that is measured (Commenter +1).
- When that person receives the branded, tracked link, clicks, and gives an email on the opt-in page, the **same Contact is updated** with the email (Subscriber +1, the "lead counter"). No new Contact is created.
- When the same commenter (recognised by the YouTube comment or author identity, or by any other stable key we have) comments on **another video**, they are **the same Contact**. No new Contact, no duplicate. We identify that the two comments belong to one person.
- Later, one Contact must tell the whole story: "this person watched 3 videos and left 3 comments, at these times, on these videos". The exact customer journey is drawn from it, and later it allows analysis such as response times.
- No duplication on purchases (already covered by Q-05 and P7-01) **and none at Contact level**. Both are required. They are separate mechanisms: P7-01 keeps one payment from being counted twice; this section keeps one person from being two people.

### 13.2 Invariants (hard rules, each one is tested)

| ID | Rule |
| --- | --- |
| I-1 | Within one account, **one person is exactly one Contact for the whole life of the account**. The Contact id never changes (a merge keeps the older id, 13.6). |
| I-2 | A Contact is created only when **no existing Contact can be recognised** from any key the event carries. If one can be recognised, it is enriched, never duplicated. |
| I-3 | Every event that carries a person attaches to a Contact through the same single resolver: keyword comment, reply, click, opt-in, purchase (any source), refund, CRM sync. There is no second code path that creates Contacts. |
| I-4 | If one event carries keys that point to **two different Contacts**, the two are **merged** into one (13.6). Merging is preferred to leaving a duplicate. Every merge is logged and reversible. |
| I-5 | Contacts are per account. The same email under two creators' accounts is two Contacts, one in each account (accounts never see each other's people). |
| I-6 | The journey is **append-only first-party history**. Nothing that happened to a Contact is overwritten when the Contact is enriched or merged; events only gain a Contact pointer. |
| I-7 | A repeat event never raises a counter it already raised for the same Contact (13.4). Comments and clicks are events and count every time; Commenters, Subscribers and Buyers are people and count once per period. |
| I-8 | Resolution is **idempotent and race-safe**: the same event processed twice, or two workers processing two events for the same person at the same moment, yield one Contact. Guaranteed by unique keys in the database, not only by application code (13.7). |
| I-9 | Nothing about a Contact is estimated. A field that is not known stays empty. |

### 13.3 Lifecycle stages

The stage is derived from real events and only moves forward (a refund does not turn a Buyer back into a Subscriber; the refund is its own event).

| Stage | UI word (B-01) | Reached when | Counter effect |
| --- | --- | --- | --- |
| Commenter | Commenter | The first keyword comment of this person is matched in this account. The Contact exists from this moment, with no email. | Commenters +1 (unique people) |
| Replied | (a fact on the Contact, not a stage) | A reply to their comment is posted (API or by hand). | Replies +1 (event) |
| Clicked | (a fact) | A non-bot click on a tracked link that was minted for this Contact's reply. A click on a static link carries no person until an opt-in ties it. | Clicks +1 (event) |
| Subscriber | Subscriber | The Contact receives its first email through an attributed opt-in (tid, or the email matches). | Subscribers +1 (unique people), once per Contact |
| Buyer | Buyer | The first purchase (canonical payment or buyer marker, any source) matched to this Contact. | Buyers +1 (unique people), once per Contact; revenue follows P7-01, P7-03 |

The owner's terms "lead" and "lead counter" map to Subscriber in the UI (B-01 keeps "lead" out of the UI).

### 13.4 Definitions that change (amends P7-07)

- **Comments** stays an event count: every matched comment, including repeats (unchanged).
- **Commenters** is new: distinct Contacts with at least one matched comment in the period. A returning commenter counts once per period, and once in "all time". A separate "new commenters" figure counts Contacts created in the period.
- **Subscribers**: distinct Contacts that received an attributed opt-in in the period (was: distinct emails). A person who opts in twice with two lead magnets, or with two email addresses, is one Subscriber.
- **Buyers**: distinct Contacts with an attributed canonical purchase (was: email, else tid). A person who buys twice is one Buyer.
- **Revenue**: unchanged (P7-01, P7-03, P7-08).
- The funnel becomes Comments, Commenters, Replies, Clicks, Subscribers, Buyers, Revenue.
- Per video and per keyword tables keep using the attributed touch (last touch within 180 days, B-08). A Contact who commented on three videos appears as a Commenter on each of the three videos (one row per video), and as one Subscriber and one Buyer under the touch attribution picks.

### 13.5 Identity model and resolution

**Tables (schema proposal, built in the first implementation PR):**

- `contacts`: `id`, `account_id`, `stage` (commenter, subscriber, buyer; denormalised for fast queries), `primary_email_norm` (nullable), `display_name` (nullable, only what the person themselves gave in an opt-in or purchase, never a YouTube display name), `first_seen_at`, `last_seen_at`, `first_comment_seen_at`, `subscribed_at`, `first_purchase_at`, `merged_into_id` (nullable, set on the loser of a merge), `created_via` (comment, opt_in, purchase, crm_sync, backfill), `created_at`, `updated_at`.
- `contact_identities`: `id`, `account_id`, `contact_id`, `kind`, `value`, `first_seen_at`, `source`, and for the YouTube kind `refresh_due_at`. **Unique on (`account_id`, `kind`, `value`)**, so one key can point to only one Contact, by construction.
- `contact_merges`: `id`, `account_id`, `winner_id`, `loser_id`, `reason` (the identity that joined them), `event_ref`, `moved` (jsonb counts), `created_at`. This is the audit log and the basis for undo.
- Foreign key `contact_id` (nullable, indexed) on `replies`, `clicks`, `subscribers`, `purchases`. These tables are first-party and kept while the account is active, so the journey survives the 30 day deletion of YouTube data.

**Identity kinds and how they are normalised:**

| Kind | Value | Strength | Notes |
| --- | --- | --- | --- |
| `youtube_channel` | YouTube channel id of the commenter (`UC...`) | strong | YouTube API data: see 13.9. Stable across display name changes. One person may have several channels, so a Contact may hold several. |
| `email` | trimmed, lowercased email | strong | First-party (the person gave it). Only trimmed and lowercased: no removal of dots or plus tags (that could merge two different people). A Contact may hold several emails (rule M-3). |
| tid (not an identity row) | click id | a **pointer**, not a key | The click row already points to link, reply and therefore Contact (`clicks.contact_id`). A tid resolves to its Contact through the click. |
| `ghl_contact` | GHL contact id (per location) | strong | So a GHL sync never re-creates the Contact. |
| `stripe_customer` | Stripe customer id | strong | Phase 8. A customer keeps one id across all their payments. |
| `comment` | YouTube comment id | fallback only | Used only when a comment has no author channel id (rare). One Contact per such comment, so it can never wrongly merge two people. |

**Resolution, in order.** The resolver receives an event with every key it has and returns one Contact (creating one only as the last step):

1. Collect all keys of the event: tid (through its click, to reply and Contact), author channel id, email, GHL contact id, Stripe customer id, comment id fallback.
2. Look every key up in `contact_identities` (and the tid through `clicks.contact_id`). Follow `merged_into_id` to the winner if a Contact was merged away.
3. **No Contact found**: create one, attach every key as an identity, set `created_via`.
4. **Exactly one Contact found**: use it. Attach every key of the event that the Contact does not have yet (this is the "update with the email" step). Update `last_seen_at`, the stage if it moved forward, and the derived fields.
5. **Two or more Contacts found**: merge them (13.6), then continue as in step 4.

Scenario table (each row is an integration test):

| Scenario | Result |
| --- | --- |
| A new commenter writes a keyword comment | New Contact, identity `youtube_channel`, stage commenter, Commenters +1 |
| The same commenter writes a keyword comment on **another video** | **Same Contact**. A new reply row on it. Comments +1, Commenters unchanged in the "all time" view. No new Contact |
| The same commenter writes a second keyword comment on the **same video** | Same Contact; a second draft as before (the Q-14 drafting rule stays: every keyword comment gets its own draft, never blocked) |
| They click their tracked link (tid) | The click gets the Contact from the reply. Clicks +1 |
| They open the opt-in page and submit an email, carrying the tid | The tid resolves to the Contact. The email is attached to **that** Contact. Stage subscriber, Subscribers +1. **No new Contact.** This is the case the owner complained about |
| They submit the email but the tid was lost (cookie, another device, form tool without the field) | The email is looked up: if it belongs to a Contact, same person; if not, a new email-only Contact is created (`created_via` opt_in). It merges with the commenter Contact later if a tid or another key ties them (rule I-4) |
| The email already belongs to another Contact, and the tid points to the commenter Contact | Two Contacts found: **merge** into the older one (13.6). The person keeps one history |
| They opt in twice (two lead magnets, or a double submit) | Same Contact, a second opt-in touch row (first-party history kept), Subscribers unchanged |
| Their Contact already has email A and an opt-in through the same tid arrives with email B | Email B is attached as an additional email of the same Contact (rule M-3), pending open question O-4 |
| They buy (any source) with the same email | The purchase gets the Contact. Buyer stage, Buyers +1 once. Revenue counted once (P7-01) |
| They buy with an email nobody knows, and no tid | New Contact (`created_via` purchase, no comment history), pending open question O-2. If they were a commenter under another email this cannot be known and is not guessed |
| Stripe customer with a known email or a `c2c_tid` in metadata | Resolved by tid first, then by email, then by customer id; the customer id is attached to the Contact |
| A subscription renewal (P7-03) | Follows the first payment and the same Contact; nothing new is created |
| A refund | Its own event on the same Contact; the stage does not move back |
| The GHL sync reads a contact with a `c2c_tid` field | Resolved by tid, the GHL contact id is attached; without a tid, by email; never a new Contact when either exists |
| The commenter changes their YouTube display name | No effect: the key is the channel id, never the name |
| The API response has no author channel id | The `comment` fallback identity is used; one Contact per such comment; never merged on a guess |
| The creator comments under their own video | Never a Contact (unchanged: the creator's own comments never trigger) |

### 13.6 Merge rules

- **M-1 Winner:** the Contact with the earliest `first_seen_at`. Its id survives; the loser gets `merged_into_id` and stays as a tombstone, so old references still resolve.
- **M-2 What moves:** every identity, and the `contact_id` on replies, clicks, subscribers and purchases, in one database transaction. `first_seen_at` takes the earlier value, `last_seen_at` the later, the stage the furthest forward. The journey is the union of both histories.
- **M-3 Several emails:** a Contact may hold several emails. `primary_email_norm` is the earliest email seen (recomputed after a merge); the others are aliases. Every email stays a key, so any of them recognises the person later.
- **M-4 Reversible:** each merge writes `contact_merges` with what moved, so a wrong merge (for example a shared inbox such as info@company.com used by two people) can be undone by an owner admin action. The undo tool is not part of the first PR; the data needed for it is.
- **M-5 Counters:** a merge never raises a counter. Where both Contacts had raised the same one, the person counts once from then on (reports are recomputed from the Contact rows, P7-05).
- **M-6 Attribution:** the merged Contact's purchases are re-attributed by the existing recompute (P7-04) on the union history. Recurring rules (P7-03) are unchanged.
- **M-7 No merge on weak evidence:** merging happens only on an exact match of a strong key. Names, IP hashes, user agents and country never merge Contacts.
- **M-8 Shared or role emails:** a merge is not blocked, because for the creator a company inbox is one lead. It is logged with the rule that caused it (M-4). See open question O-5.

### 13.7 Concurrency, ordering and idempotency

- The unique index on (`account_id`, `kind`, `value`) makes duplicates impossible even if two workers race. Creation is `INSERT ... ON CONFLICT DO NOTHING`, then read back the winner.
- Resolve and merge run inside one transaction that takes a per-account advisory lock for the (short) resolve step. An account's people are resolved one at a time; accounts do not block each other.
- The resolver is called from the places that already emit events (P6-12): comment insert in the worker, inbound hooks, GHL sync, Stripe sync. The redirect never waits for it: the click row takes the Contact from the reply it was minted for, which is already known.
- Events may arrive out of order (a CRM sync after the purchase webhook, a purchase before the opt-in). The result is the same in any order, because each event only adds keys and links, and a later key that ties two Contacts triggers a merge.
- Replaying any webhook, sync page or job never creates a second Contact or a second identity.

### 13.8 The customer journey

The journey of a Contact is assembled from first-party rows, oldest first:

`comment seen` (from `replies`: video id, keyword, intent, language, `created_at`), `reply approved`, `reply posted`, `click` (link, host, country, bot flag), `opt-in` (source, email, consent flag), `purchase` (amount, currency, source, subscription), `refund`, `merge`.

Rules:

- **Timestamps are our own observations** (when we detected the comment, when the creator approved, when we posted, when the click and the opt-in happened). YouTube's own publish time of a comment is API data and is not the basis of the journey (P7-10). Detection delay is minutes (polling tiers), so response times are accurate to that.
- **Only keyword comments exist in the journey.** Comments that do not match a keyword are never stored (P4-04, data minimisation). "This person left 3 comments" means three keyword comments. See open question O-3.
- The journey survives the 30 day deletion of comment text, because it lives in `replies` and the other first-party tables, not in `comments`.
- Analyses this enables, all from real data: time from comment to approval, to reply, to click, to opt-in, to purchase per Contact; number of videos and comments before subscribing or buying; which video and keyword was the first touch and which the last; repeat commenters versus one-time commenters; response time versus conversion (extends R-35 item 2).
- A Contact page in the app (timeline plus the facts above) is planned as its own PR after the data is correct. The data model in this section is the prerequisite.

### 13.9 YouTube data compliance: the one real tension (needs owner attention)

Recognising a returning commenter needs the commenter's **YouTube channel id**, which is YouTube API data. Three existing rules meet here:

1. **30 day rule** (Q-17 c, YouTube API Developer Policies III.E.4.c and d): stored API data must be **deleted or refreshed** after 30 calendar days. Refreshing is explicitly allowed.
2. **Q-14** said no commenter identity is stored. The owner has now asked for exactly that recognition. **Q-14 is amended:** the drafting rule stays (every keyword comment gets its own draft, no blocking); the "no commenter identity stored" part is superseded by this section.
3. **P4-11** chose deletion over refresh for comments. **P4-11 is amended** for one narrow thing: the *reference* that recognises a person (comment id and author channel id) is refreshed instead of deleted. Comment text and display names are **still deleted at 30 days**.

Design (P8-C-01 to P8-C-04, proposals):

- **P8-C-01 Refresh, not keep.** Each `youtube_channel` identity stores the id of the latest comment that showed it (`ref_comment_id`). The daily retention job asks YouTube for those comments with `comments.list` by id (1 unit per up to 50 comments, ledgered, on the reads budget), starting 5 days before the 30 days run out so a bad day can be retried. If YouTube still returns the comment with the same author, the identity is confirmed for another 30 days (`refresh_due_at`). If the comment is gone or the author differs, the identity is deleted; so is any identity that reaches its due date unrefreshed. Only that one comment id is kept per identity (the comment text and display name are still deleted at 30 days), so a commenter who deleted exactly that comment stops being recognised even if they wrote others; accepted, as deletion is arguably intent. The Contact and its first-party history (emails, replies, clicks, opt-ins, purchases) stay.
- **P8-C-02 Never leaves the app.** Author channel ids are never in outbound webhooks, GHL payloads, emails, exports or reports (already true since P6-02) and are not shown in the UI. They are used only to recognise a returning commenter.
- **P8-C-03 Disconnect and revoke** delete every `youtube_channel` identity and comment reference of that channel within the existing 7 day rule (in practice at once), like other YouTube data. Contacts remain, with their first-party history; they can no longer be recognised by YouTube id.
- **P8-C-04 Disclosure.** The Privacy Policy and Terms drafts get an explicit paragraph: the app stores the commenter's channel id to recognise a returning commenter, refreshes it every 30 days, never shares it, and deletes it on disconnect. This is added in the same PR as the schema (docs/compliance/).
- **Correlation risk, to be verified before the Google submission.** The YouTube API policies require honesty about what is collected and use only within the privacy policy and the user's consent (III.E.3.a and c), and their overview forbids tracking or deriving information that identifies a user without consent. Linking a commenter's channel id to an email they typed on the creator's opt-in page is a correlation the reviewer may treat as needing consent. Current mitigation: the person gives the email themselves, the linkage is disclosed, and the id never leaves the app. It must be re-checked with the Google OAuth verification pack (docs/compliance/); if the reviewer objects, the fallback is O-1 option B. This is a compliance risk, not a legal opinion.

### 13.10 Effect on the other systems

- **Outbound webhooks** (P6-02): payloads add an opaque `contact_id` (our uuid). Still no YouTube ids, comment text or names. Consumers can dedupe on it.
- **GoHighLevel** (P6-10): upsert by email as now; the GHL contact id is stored as an identity, so the next sync recognises it. We never create a GHL contact for a Commenter without an email (there is nothing to upsert).
- **Inbound hooks** (`/api/hooks/optin`, `/api/hooks/purchase`): resolve through the same resolver. Responses are unchanged.
- **Attribution** (Phase 7): the touch search and the recompute work on Contacts (all touches of a Contact, whatever email was used), so a purchase under email B is still attributed to the video whose tid arrived with email A. Rules P7-01 to P7-04 are otherwise unchanged.
- **Reports** (Phase 7): definitions in 13.4.
- **Stripe (Phase 8):** resolves purchases into Contacts by the rules above; the Stripe customer id becomes an identity.
- **Backfill:** one migration builds Contacts from the existing data: replies with a still stored comment (author id), subscribers and purchases grouped by email, tid links through clicks. It merges by the same rules, is idempotent and can be re-run.

### 13.11 Tests that must exist before this ships

Unit: normalisation of emails, resolver decisions for every scenario row in 13.5, winner selection, stage never moving back. Integration (Postgres): the same commenter on two videos gives one Contact; an opt-in through a tid updates the commenter Contact and creates none; an opt-in with an email of another Contact merges; two workers racing on one new commenter give one Contact; replaying a webhook and a GHL sync page changes nothing; a merge moves every row and can be traced; a purchase under a second email still attributes to the first touch; disconnect wipes YouTube identities but keeps Contacts and history; refresh keeps an identity for 30 more days when the comment exists and drops it when it does not; report counters for Commenters, Subscribers and Buyers count people once.

### 13.12 Owner decision record and open questions

| ID | Decision |
| --- | --- |
| Q-23 | **Owner decision (2026-09-26), supersedes Q-14 in part:** one person is one Contact for the whole life of an account. Opt-ins, second comments on other videos, purchases and CRM syncs enrich the existing Contact and never create a duplicate. The customer journey is kept per Contact. No duplication at purchase level (Q-05) and none at Contact level; both are required. |
| P8-C-01 to P8-C-04 | Proposals in 13.9 (refresh the YouTube reference, never share it, wipe at disconnect, disclose in the privacy drafts). Await owner confirmation. |
| P8-C-05 | Proposal: the Contact core (schema, resolver, backfill, wiring, tests) ships **before** the Stripe connector, in its own small PRs, so Stripe purchases resolve into Contacts from the first line. Phase 8 then follows. |

Open questions for the owner. Each has a recommended default, which is what gets built unless the owner says otherwise. None blocks the start of the work.

| # | Question | Recommended default | Alternative |
| --- | --- | --- | --- |
| O-1 | **How long may we recognise a returning commenter?** Recognition needs the channel id, refreshed every 30 days (cost: 1 unit per 50 comments, negligible). Acceptable for the Google review? | **A: refresh monthly** (13.9). A returning commenter is recognised for as long as their old comment exists on YouTube. | **B: keep the id only 30 days, no refresh.** A person who comments again after more than 30 days, and never gave an email, becomes a second Contact. Safer for Google, weaker for the journey. Also the fallback if a reviewer objects to A. |
| O-2 | **Who gets a Contact?** Only commenters, or also people who arrive without a comment (an organic opt-in, a Stripe customer we never saw comment)? | **Everyone with an email.** Otherwise a later opt-in of a known buyer would create a second Contact. They start with `created_via` opt_in or purchase and no comment history. | Only commenters; the others stay as plain rows matched by email at query time (simpler, but a person can then appear twice in a Contact list). |
| O-3 | **Should a known Contact's non-keyword comments be recorded** ("also commented 'great video' on video 4")? | **No.** It means storing comments we do not need, which is API data, and raises the compliance and volume load. The journey shows keyword comments only. | Record a minimal marker (video id and time only, no text) for comments by already known Contacts. Costs no extra quota (the poll already reads them) but adds stored YouTube data. |
| O-4 | **Two different emails arrive for one Contact** (for example a forwarded link): keep both as one person? | **Yes, same Contact, the second email as an alias** (M-3). The tid proves the path from that comment. | Treat the second email as a new person linked to the first. Better if you expect many forwarded links, but it brings duplicates back. |
| O-5 | **Automatic merge on an email match, even for shared inboxes** (info@company.com)? | **Yes, always merge on an exact strong key, log it, allow undo** (M-4, M-8). | Never auto-merge role addresses (info@, sales@, support@): keep two Contacts and flag them for review. Fewer wrong merges, some duplicates. |
| O-6 | **Reporting change:** Subscribers and Buyers become people (Contacts) instead of distinct emails (13.4). For most accounts the numbers are identical; a person with two emails now counts once. OK? | **Yes.** | Keep counting distinct emails. |

### 13.13 Owner instruction: the 30 day rule stays intact; a legal workaround is a later review (2026-09-26)

| ID | Decision |
| --- | --- |
| Q-24 | **Owner decision:** the 30 day rule for YouTube API data (Q-17 c, III.E.4.c and d) **stays fully intact**. Nothing in the Contact model may keep YouTube API data beyond 30 days without a refresh that YouTube's own policy allows. The implementation in 13.9 (confirm with YouTube every 30 days, otherwise delete) is the accepted baseline and is built. |
| L-01 | Main call to action: "Audit my channel, free". **No free trial** is offered until the first 100 founding sales; the owner may decide otherwise after that. (Replaces the first L-01 of the same day, "Start your free trial".) |

## 14. Phase plan change (owner, 2026-09-26)

| ID | Decision |
| --- | --- |
| Q-25 | **Owner decision:** the former Phase 11 (Enterprise BYOK: per-account Google OAuth client and GCP project, separate quota ledger) is **removed from the phase plan** and is not scheduled. The direction after Phase 10 is **deliberately open**: it may become an Agency, White-label or Affiliate offer, or something else. Nothing is built or reserved for it, and it is not listed as a phase in STATUS.md until the owner decides. D-32 (Enterprise plan with BYOK) stays on record as an earlier idea, on hold. The `enterprise` plan row that already exists in the plans table is data only and stays untouched. Phase numbers are not renumbered, so references to Phase 12 stay valid. |

## 15. Phase 8 implementation choices: Stripe (proposals, 2026-09-26)

Closes Q-17 e: Stripe Connect `read_only` OAuth is not available to new integrations, so the connector uses a **creator-provided restricted read-only key**. A Stripe App (marketplace review) stays possible later without changing the data model, because payments land in the same `purchases` table and go through the same Contact resolver (section 13).

| ID | Choice | Why |
| --- | --- | --- |
| P8-01 | The creator creates a **restricted key** in their own Stripe dashboard with read permission on Charges, Customers and Invoices, and pastes it on `/app/integrations`. Only `rk_live_` keys are accepted: a full secret key (`sk_`) is refused because it can move money, and a test-mode key (`rk_test_`) is refused because only real revenue is counted (D-05). The key is encrypted at rest (AES-256-GCM), never shown again (only its last 4 characters), never logged. Disconnecting wipes it; the page tells the creator to delete or roll the key in Stripe, which is the only real revocation. | Least privilege, no Stripe review, and no platform secret to guard. |
| P8-02 | Read-only **polling every 5 minutes** in the worker, the same rhythm and machinery as the GHL sync. No Stripe webhooks: creating an endpoint needs a write permission. Calls use `GET /v1/charges` with `expand[]=data.customer` and `expand[]=data.invoice`, and a pinned `Stripe-Version` so a Stripe default change never changes the numbers. | Read-only by construction; polling is the floor, as in P6-09. |
| P8-03 | A payment is a **successful, paid charge**: external id = charge id, amount = `amount_captured`, refunds = cumulative `amount_refunded` (capped at the amount), currency upper-cased, nothing converted (Q-08). A charge that belongs to an invoice with a subscription carries `subscription_ref` (both the classic `invoice.subscription` and the newer `invoice.parent.subscription_details.subscription` are read), so renewals follow the first payment for life (Q-07, P7-03). | Q-05, Q-06, P7-03. |
| P8-04 | The buyer is resolved by the Contact resolver (13.5): email (customer, else billing details, else receipt email), a `c2c_tid` in the charge or customer metadata, and the Stripe **customer id**, which is stored as an identity. The same customer paying with another email is still the same Contact. A charge with no email, no tid and no customer is stored without a Contact and stays unattributed. | Q-23: no duplicate people. |
| P8-05 | **History:** the first sync imports the last 730 days, quietly: charges older than 3 days appear in reports but fire no outbound event and no GHL tagging, so a creator's automations are never flooded with old sales. A daily 90 day pass and a 2 day overlap on every run pick up refunds. Big histories are read in slices of at most 40 pages (4,000 charges) per run and resumed on the next run. | Real history from day one without side effects. |
| P8-06 | When the same sale also arrives from GoHighLevel or an inbound webhook, **Stripe is the canonical source** (P7-01 source order), so revenue counts once. | Q-05. |
| P8-07 | One Stripe account per creator account, and a Stripe account in one creator account at most (`external_ref` = the Stripe account id, when the key can read it). | Prevents two creators counting the same money. |
| P8-08 | A rejected key (HTTP 401 or 403) sets the integration to `error` with the reason and emails the creator once to reconnect; nothing recorded is lost. Any other failure is retried on the next run and shown on the page. | Same behaviour as GHL (P6-08). |
| P8-09 | `STRIPE_CONNECT_CLIENT_ID` and `STRIPE_SECRET_KEY` are no longer needed and are removed from `.env.example`. No owner setup exists for Stripe. | The key belongs to the creator. |

## 16. Phase 9 implementation choices: Audit my channel (proposals, 2026-09-26)

Method and signatures come from the 03 research (`c2c-market-research/fingerprint.py` and `validate.py`, closes Q-22). Everything is rule-based, no LLM (Q-18), and every number is measured (D-05).

| ID | Choice | Why |
| --- | --- | --- |
| P9-01 | Public page `/audit` on the app host, no sign-in. The web service never calls YouTube or a creator's site: the form creates an `audits` row and a worker job (`audit.run`); the result page refreshes itself until the row is done. Each request has its own row and an unguessable id in the URL (`/audit/<uuid>`, `noindex`). | D-36: the UI never waits on an external API. |
| P9-02 | Accepted input: `@handle`, a channel URL with `/@handle`, `/channel/UC...` or legacy `/user/name`, or a bare handle or channel id. `channels.list` (`forHandle`, `id`, `forUsername`) costs 1 unit. Custom `/c/name` URLs are refused with a hint: resolving them needs `search.list` (100 units). | Quota of the separate audit project. |
| P9-03 | Own quota: `quota_ledger.gcp_project = "audit"`, key `YT_API_KEY_AUDIT` from its own GCP project (D-34), daily limit `AUDIT_DAILY_LIMIT` (default 10000) with no reply reserve. One audit reads the channel (1), the uploads playlist (1), the last 5 videos (1) and up to 2 comment pages per video (10): at most 13 units, about 750 audits a day. Units are charged before each call, a failed call is charged too. Over the day's budget the page says so honestly and asks to come back after the Pacific midnight; nothing is estimated. | D-31, D-34; the app project's quota is never touched. |
| P9-04 | What is measured, on the last 5 uploads and up to 200 newest top-level comments each: questions (a question mark, or an interrogative opener of 5+ words), buying signals (English patterns: price, how do I buy or join, link please, do you offer a course, and similar), and for both whether the creator replied. `commentThreads.list` returns at most 5 replies per thread, so a thread with more replies than returned and none from the creator is `unknown` and never counted as unanswered. The creator's own comments are excluded. Keyword candidates: words (not filler) that appear in at least 3 different comments (2 when under 40 comments), top 5. The findings say "look like": it is pattern matching, not a judgement. | Real numbers only; the same result every time. |
| P9-05 | Link audit: links from the channel description and the last 5 video descriptions, social and platform hosts skipped, at most 8 unique links, each followed through at most 3 redirects (5 s, 1 MB, http and https on ports 80 and 443 only, private and metadata addresses refused at connect time, every redirect re-checked). Link hubs (linktr.ee, beacons.ai and similar) are expanded one hop. A link is **measured** when it carries UTM parameters or `c2c_tid`, or goes through a click-counting redirector (bit.ly and similar); **own domain** means the final host is not a platform or shortener host. The audit fetcher identifies itself with a `vidrev-audit` user agent and reads one page per link. | SPEC-REVIEW R-16 (SSRF), 03 research method. |
| P9-06 | Stack detection reuses the 03 signatures. GoHighLevel counts only on the creator's own page: `leadconnectorhq`, `msgsndr`, `filesafe.space`, `clientclub.net`, or a CNAME to `leadconnector`, `msgsndr`, `ludicrous.cloud` or `highlevel`; `gohighlevel.com` and `highlevel.com` pages (affiliate links) never count. HubSpot and Mailchimp count only on form and page assets, not on tracking scripts (the research over-counted HubSpot at 17.5% for that reason). Amazon links count on the URL only. The result carries a segment: `ghl`, `other` or `none` (PRD: segmentation by stack). | 03 research limits and validation. |
| P9-07 | Storage: `audits.result` holds counts and derived numbers only. **Comment text is never stored**; it exists in worker memory while it is analysed. What comes from the YouTube API (channel title, video titles, comment and video ids as pointers, description links) lives in `audits.examples` and the resolved channel id in `youtube_channel_id`; the daily retention job wipes those 30 days after `fetched_at` (Q-17 c), counts and score stay. A cache hit copies the result and keeps the original `fetched_at`, so the 30 days never restart. | Q-17 c, III.E.4; SPEC "raw comments deleted within 30 days" is met by not keeping them. |
| P9-08 | Comment Conversion Score 0 to 100 = the weighted mean of the factors that had enough data: questions answered (30, needs 3 questions), buying signals answered (30, needs 2), videos with a link (20), description links that are measured (20). Factors without data are left out and the rest re-weighted; under 40 points of weight there is no score. The factor list is shown next to the number. | Explainable and honest; no invented baseline. |
| P9-09 | Instant preview: the 3 strongest findings by a fixed strength order (no comments, unanswered buying signals, unmeasured links, unanswered questions, videos without a link, keyword candidate, stack). Fewer than 3 real findings show fewer. The score and every finding go in the full report. | D-10, PRD "3 findings". |
| P9-10 | Full report by email: the visitor enters an email, the report is sent to that address only (no web copy, so the email is the gate). Transactional delivery needs no marketing consent; the separate marketing checkbox is never pre-checked (D-08) and its answer, text version and time are stored. Limits: 3 reports a day per address, 1 per audit. The email carries counts, the score with its factors, titles and links to the exact comments (never comment text) and the link table. | Consent rules D-08; YouTube data leaves as pointers, not content. |
| P9-11 | Abuse limits: 5 audits an hour per address (in memory, like the inbound hooks), the 24h cache per channel (a hit costs no quota), the daily audit budget, and optional Cloudflare Turnstile on the form (`TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`; enforced only when both are set). The Turnstile check is one short call in the web request (4 s timeout, fails closed) and the only external call on the web path; the audit itself always runs in the worker. | R-16. |
| P9-12 | Not built: re-audit reminder and score history after 30 days (PRD "Re-audit"; the 24h cache already lets a creator run it again), and automatic delivery of opt-ins to the owner's CRM (they are listed in `/admin`). | Scope of the phase. |

## 17. Phase 10 implementation choices: GHL Marketplace connector (proposals, 2026-09-26)

| ID | Choice | Why |
| --- | --- | --- |
| P10-01 | Two ways into the same callback (`/api/oauth/crm/callback`): our own "Connect" button (signed state cookie, signed-in user, as in Phase 6) and the Marketplace listing's Install button (no state cookie, the installer may not be signed in). The Marketplace path exchanges the code at once (codes are short-lived). Signed in already: the location is connected to that account straight away. Not signed in: see P10-02. | One-click install must work from the listing, and the callback URL stays the one registered in the app. |
| P10-02 | A grant of a location that no account owns waits in `ghl_installs` for 24 hours, sealed (AES-256-GCM), keyed by the sha256 of a claim token that only the installer's browser holds (signed cookie `ghl_claim`). The page `/connect/crm` and the dashboard offer "Connect to this account" to a signed-in user with that cookie; the claim reads the token from the cookie, never from a link or a form. A refused claim keeps the grant for a retry; a used or expired one is gone (retention deletes leftovers daily). The latest install of a location replaces an earlier waiting one. | Billing lives in GHL and accounts exist only after a purchase (B-04), so an installer can arrive with no account; matching a location to an account by its email would let anyone who sets that email on their own location attach to a stranger's account, so the account is always proven by a sign-in. |
| P10-03 | A reinstall of a location that already belongs to an active account only refreshes the grant in that account (choices such as the buyer tag are kept). It never moves a location to another account; a location owned by a suspended account waits like a new one and a claim by another account is refused (`location_taken`). | Nobody can take over a connected location by installing. |
| P10-04 | Agency level installs are refused with a plain message (`not_location`): the app is location level. The claim page path is `/connect/crm`, which avoids "ghl" and "highlevel" like the other URLs HighLevel sees. | Q-17 b, white-label rule in docs/SETUP-GHL.md. |
| P10-05 | One marketplace **workflow action**, "Find the video behind this contact", at `POST /api/hooks/crm/action` (path without "ghl"/"highlevel"). HighLevel sends `{ data, extras: { locationId, contactId, workflowId }, meta }`; the portal is set up to send the shared secret `GHL_ACTION_SECRET` in the header `X-Vidrev-Key` (compared in constant time; unset means every call is refused). The location must map to a live connection, and the HighLevel contact id must be an identity of one of that account's Contacts, so a call can only ever read the people of the account that owns the location. The answer is always the same seven variables (`found`, `video_id`, `video_url`, `keyword`, `intent`, `stage`, `opted_in_at`; empty when nothing is known) so a workflow never breaks on a missing one. The optional field `add_note` (default yes) queues a note on the contact ("vidrev source", video link, keyword and intent, opt-in time) through the worker; it holds first-party facts only, never a comment, a commenter name or a video title. The web request itself makes no external call. | SPEC section 14 ("Add note: C2C source"); variables are more useful than a note alone, and the read is our own data (D-36). |
| P10-06 | **No custom workflow trigger.** HighLevel documents the subscription payload of a custom trigger but not how an app fires it (method, authentication and body of the `targetUrl` call are not in the public docs). Meanwhile every attributed contact already gets the tags `c2c`, `c2c_kw_<keyword>`, `c2c_vid_<videoId>` (P6-10), and HighLevel's built-in "Contact Tag" trigger starts a workflow from them, so creators lose nothing. Revisit if HighLevel publishes the firing contract or the owner wants a named trigger in the listing. | Not built on a guess; SPEC calls the trigger optional. |

## 18. Landing, funnel and lead magnet (owner, 2026-09-28)

| # | Decision |
| --- | --- |
| L-01 | Main call to action on the landing page: "Start your free trial" (sell now). Audit my channel moves lower on the page. |
| L-02 | The landing page and funnel are built in GoHighLevel on `vidrev.app`, not in the app code. `app.vidrev.app/` stays the app front door. |
| L-03 | No automatic nurture emails yet. Campaigns are drafted first, following the owner's method: ASK or Survey campaign, Launch campaign, Webinar campaign, 4D Cash Machine campaign, joined by Lead Compounding along the lead temperature (Cold, Warm, Hot). |
| L-04 | No social proof exists yet; the layout keeps a place for it. |
| L-05 | Section structure follows commentshark.com and replytide.co (the owner's reference pages), without social proof. Structure is mirrored; all copy is our own. |
| L-06 | Lead magnet direction (fixed): every lead magnet is personal to the visitor (never a generic PDF), gives value at once, and demonstrates what vidrev would do on their own channel. Audit my channel is the first one; it gets a redesign phase after the landing page. |
| L-08 | The 14-day trial (D-37, B-05) is **paused**: no page, email or checkout offers it, and provisioning must not grant it. The trial code and plan data stay dormant until the owner reopens it; future work must not build on the trial. |
| L-09 | USPs: the only revenue attribution app for YouTube organic traffic; direct integration with GoHighLevel or the creator's CRM; "No more cold outreach" (buyers raise their hand in the comments). Section plan: Drive doc "06 vidrev Landing szekciók". |
| L-10 | Build path: the landing page is designed and approved as plain HTML and CSS in-house first (self-contained sections, scoped class names, no build step), then moved into GoHighLevel as Custom Code sections. Every CSS class and id starts with `vidrev-` (for example `vidrev-hero`), never a shorter prefix. GoHighLevel is the final home; checkout and opt-in forms stay native GoHighLevel elements. |
| L-11 | The audit is renamed "See where I lose money on YouTube". Its end result is a money figure the creator can trust: computed from their own real comment counts and the price and conversion they enter, never estimated by us (keeps "real numbers only"). |
| L-12 | Audit v2 content (owner, 2026-09-28): the 3 strongest buying signals and sample vidrev replies are shown without email; the creator's price and buying rate are required (a wished-for price is fine when nothing is sold yet; filtering out freeloaders is accepted); a per-1,000-views comparison of AdSense (one-time) and the Ownership Method (leads, recurring) is shown, clearly labelled as an example on the creator's own inputs; the CTA goes straight to the founding offer. Prototype: `design/audit-v2/index.html`. |
| L-07 | Privacy and Terms go live once the LLC exists; drafts stay in docs/compliance. |
