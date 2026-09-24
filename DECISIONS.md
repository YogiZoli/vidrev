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
