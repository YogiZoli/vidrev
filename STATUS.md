# STATUS

Last updated: 2026-09-29 (Phase 14 restructure done)

## End goal

A production SaaS that turns keyword comments into subscribers, buyers and revenue, attributed per video and keyword, with tracked links on the creator's own domain and approval-only replies. See [docs/PRD.md](docs/PRD.md) and [docs/SPEC.md](docs/SPEC.md).

## Review 2026-09-28

- Main CI was red since #57: a date-bound test (fixed clock for the report, real clock for the reply row). Fixed in #59.
- Live: `app.vidrev.app` (app, health ok), `go.vidrev.app` (links). `vidrev.app` has no DNS record: the brand site (landing, Privacy, Terms, checkout) is planned in GoHighLevel (D-28) and was never built. `/privacy` and `/terms` do not exist anywhere yet, which blocks Google verification.
- The app front door `app.vidrev.app/` is a sign-in page with an audit button, not a landing page. Audit my channel is a standalone page by design (P9); on the future landing it becomes one section (like "See it on your own channel") that posts to `app.vidrev.app/audit`.
- Not built for a working v1: brand landing and funnel, checkout to provisioning run end to end, Resend sending domain (magic links and reports), live end-to-end run on the owner's channel, first real audit.
- Audit fails live ("Something went wrong while reading the channel"): YouTube answers `API_KEY_INVALID` for `YT_API_KEY_AUDIT` on Railway. Owner creates a new key in GCP project `vidrev-audit` and sets it on both services. No code change needed (env values are trimmed).
- Email: `EMAIL_FROM` is not set, so mail goes from the Resend test sender, which only reaches the Resend account owner. Owner verifies `vidrev.app` in Resend (DNS on Cloudflare) and sets `EMAIL_FROM` on both services.
- Privacy and Terms postponed by the owner until the LLC exists; brainstorm and app fixes first.
- 2026-09-28: new audit key and Resend domain live, `EMAIL_FROM` set; a fresh audit of @zoltangero completes. One run (10:47 UTC) hung on the worker started at 10:46 and was failed by the stuck-audit sweeper after the next deploy; cause not proven (likely deploy overlap), watch for a repeat.
- Landing and funnel decisions in DECISIONS section 18 (L-01 revised: audit is the main CTA, no trial until 100 founding sales; L-08 trial paused).
- `/audit/sample` shows a sample audit (invented channel, real analysis, full report email). Audit redesign proposal: Drive doc "07 vidrev Audit újratervezés", waits for the owner. Landing sections: Drive doc "06 vidrev Landing szekciók".
- Fixed a second date-bound test (#65, weekly summary on Mondays).
- Audit v2 "See where I lose money on YouTube" is live (#69): `/audit`, `/audit/<id>`, `/audit/sample`. Owner to set `FOUNDING_CHECKOUT_URL` (GoHighLevel checkout) on `web`; until then the CTA goes to `BRAND_BASE_URL`. Comment text is still never stored, so the waiting comments show the video title and a YouTube link, not the text.
- Landing v1 approved by the owner (2026-09-28): `design/landing/index.html`, 13 sections, copy per L-13 (#73, #74). Audit v2 layout: calculator above the fold, standout comparison (#72).
- Landing live on vidrev.app (GoHighLevel funnel, copy kit #76 to #82). Audit leads go to the owner's GoHighLevel Sub-account vidrev (#83): contact upsert with audit fields, tags vidrev-lead-audit, temp-warm, vidrev-consent-marketing (consent only). `OWNER_GHL_API_KEY` and `OWNER_GHL_LOCATION_ID` set on `worker`. Open issue closed: "delivery of audit opt-ins to the owner's CRM".
- App restructure (onboarding wizard, Video > Keyword > Target URL, Settings) runs in a separate session with its own prompt.
- Next: owner builds the GoHighLevel checkout for Founding 100 and sends the link (`FOUNDING_CHECKOUT_URL`); then move the landing into GoHighLevel on `vidrev.app` as Custom Code sections; then campaign drafts (L-03).
- Next: owner brainstorm on the landing page and funnel, then a phase plan (not started).

## Phases

| # | Phase | Status |
| --- | --- | --- |
| 0 | Bootstrap: repo docs, decisions, PRD, SPEC, .gitignore, .env.example | **DONE** (2026-09-25) |
| 1 | SPEC review: gaps, risks, owner decisions, proposed fixes | **DONE** (2026-09-25); answers in DECISIONS sections 5 and 6 |
| 2 | Scaffold and deploy: app skeleton, Postgres, migrations, health check, CI, Railway project `c2c-saas`, first deploy | **DONE** (2026-09-25) |
| 3 | Accounts: magic-link login, provisioning webhook, plans and seeds, OAuth connect with encrypted tokens | **DONE** (2026-09-25); verified end to end on 2026-09-25 |
| 4 | Comment engine: channel polling tiers, PubSubHubbub, keyword rules, AI drafts, templates, approval queue, quota-budget sending, transparent queue, manual fallback, quota ledger, retention job | **DONE** (2026-09-25), PRs #2 to #7; end-to-end check on the owner's channel pending (owner setup below) |
| 5 | Tracked links on the user's own domain: CNAME onboarding, DNS check, Cloudflare for SaaS TLS, fallback domain, click ids, mapping | **DONE** (2026-09-25), PRs #8 to #10; live on vidrev.app since 2026-09-25 (PR #11 adds the spend cap and the Worker) |
| 5b | Compliance pack (Q-17 a): Privacy/Terms drafts, OAuth verification pack, quota extension request | **Prepared** (2026-09-25), [docs/compliance/](docs/compliance/README.md); submission waits for the LLC (EIN not needed) |
| 6 | Integrations: outbound HMAC webhooks and tags, GHL OAuth, inbound opt-in and purchase webhooks | **DONE** (2026-09-25), PRs #13 to #15; GHL connected live on 2026-09-25 (Sub-account YTC2C, first syncs without errors) |
| 7 | Attribution and reporting | **DONE** (2026-09-26), PRs #17 to #19; waits for the first real purchase to show numbers |
| 7c | Contact identity (Q-23): one person is one Contact, journey per Contact, reports by people | **DONE** (2026-09-26), PRs #21 to #23; DECISIONS section 13 |
| 8 | Stripe revenue ingestion (read-only, creator-provided restricted key) | **DONE** (2026-09-26), PR #24; waits for the first real Stripe key |
| 9 | Audit my channel | **DONE** (2026-09-26), PRs #26 to #28; needs the owner setup below before it works live |
| 10 | GHL Marketplace connector | **DONE** (2026-09-26), PRs #30 to #32; the app is ready for "Start Public review", which waits for the LLC ([docs/MARKETPLACE-LISTING.md](docs/MARKETPLACE-LISTING.md)) |
| 12 | Compliance and launch readiness | **DONE** (2026-09-26), PRs #34 and #35; submission waits for the LLC and owner steps ([docs/compliance/LAUNCH-CHECKLIST.md](docs/compliance/LAUNCH-CHECKLIST.md)) |
| 14 | App restructure: mandatory onboarding, one core flow (Video, Keyword, Target URL), new navigation | **DONE** (2026-09-29), PRs #85 to #91; DECISIONS section 19 |
| 13 | Restyle to the Shine design (v3): tokens, shells, every page, micro-interactions | **DONE** (2026-09-26), PRs #40 to #58; test fix #59 |

Phase plan changes (all accepted): compliance pack and quota extension request right after Phase 5 (Q-17 a); one GHL Marketplace app created Private in Phase 6 and made Public in Phase 10 (Q-17 b); retention job in Phase 4 (Q-17 c, done); Cloudflare for SaaS spike once the brand domain exists (Q-17 d).

## Phase 14: restructure (done)

Plan (owner approved 2026-09-29): 1 navigation and Settings, 2 onboarding gate (additive migration: `accounts.default_target_url`, `onboarded_at`; no polling, drafts or quota before it is complete), 3 onboarding wizard (YouTube, GoHighLevel, purchase source, default target URL), 4 and 5 Campaigns flow (Video, Keyword with lead temperature, Target URL), 6 docs and checks. Existing all-video rules keep running (owner choice a).

- Step 1 done: top tabs Home (approval queue plus this month's numbers), Campaigns, Reports, Settings (dropdown), Owner admin for ADMIN_EMAILS only (server gate unchanged). Settings groups: Account (Account, Billing and cancel), Connections (YouTube channel, GoHighLevel, Stripe), Developers (Webhooks, Inbound endpoints), Links (Linked domain). Old paths redirect; `/app/settings/integrations` forwards each notice to its page.
- Step 2 done: `drizzle/0012` adds `accounts.onboarded_at`, `purchase_source` (`ghl` or `stripe`), `default_target_url`. `/app` redirects to `/onboarding` until `onboarded_at` is set (`src/server/onboarding.ts`: four steps in order, stamped once, never unset by a later disconnect). The worker neither polls, reads RSS nor drafts for an account without it. OAuth and Stripe connects return to `/onboarding` while it is not done. Existing accounts (the owner's vidrev Sub-account too) go through `/onboarding` once after deploy; until then their channel is not polled.
- Step 3 done: target URL prefilled from the GoHighLevel Sub-account website (read at setup with `locations.readonly`, stored as `locationWebsite` in the sealed config; no new scope); GoHighLevel connect errors return to `/onboarding`; the onboarding header offers Sign out. Optional `GHL_AFFILIATE_URL` (owner's affiliate link) shows "No GoHighLevel yet? Start a free trial" with a commission disclosure on the CRM step; off until set.
- Step 4 done: `/app/campaigns` is the core flow in order: 1 Video (picker from the channel's public feed plus known videos, no API quota; pasted links as fallback; at least one video required, the "all videos" option is gone for new rules), 2 Keyword, 3 Target URL (default from onboarding). Existing all-video rules keep running and show "All videos" (owner choice a). Reply language and AI settings moved to Settings > Replies. Webhooks and Inbound endpoints carry a self-service, no-support note.
- Step 5 done: keywords come from a catalog (`src/lib/keyword-catalog.ts`, GUIDE first and default), each with its lead temperature (Cold blue, Warm amber, Hot red chips; stored as `campaigns.intent`, no migration). "Name what the viewer gets" and "Other spellings" are gone; misspellings (GUDIE, GIUDE, GUIDES...) are generated and stored as `aliases`, shown and editable under a closed "Advanced". Own keywords show "Coming soon". "All my videos, including new uploads" is back as an explicit choice next to picking videos (owner, 2026-09-29). UI says lead temperature everywhere (queue, campaigns, reports).
- Step 6 done: SPEC section 3a and DECISIONS section 19 (R-01 to R-07); final local click-through from onboarding to approval.
- Owner check after deploy: sign in to the vidrev Sub-account account, pass `/onboarding` once (polling is paused until then), create the first campaign.
- Later (owner, 2026-09-29): set the real `GHL_AFFILIATE_URL` (only a temporary link exists now); put "Works with GoHighLevel (free trial through our link if you do not have it)" on the landing page and the checkout before the founding sale opens.

## Contacts (Q-23): what was built

- One person is one Contact per account (`contacts`, `contact_identities`, `contact_merges`, `contact_id` on replies, clicks, subscribers, purchases; `drizzle/0009`). A single resolver (`src/server/contacts.ts`) is the only place Contacts are created: keyword comment (worker), click (from the reply), opt-in, purchase, GHL sync, Stripe sync. Keys: YouTube channel id, email, GHL contact id, Stripe customer id, tid through its click. Recognised means enriched, never duplicated; two Contacts found by one event are merged into the older one and logged. Race-safe (per-account advisory lock plus a unique key).
- The same commenter on another video is the same Contact; an opt-in through the tracked link updates the commenter Contact with the email (no new Contact); a second email of the same person is an alias. Idempotent backfill for older rows runs at worker start and hourly (`src/server/contacts-backfill.ts`).
- Reports count people once (`src/lib/report.ts`): new Commenters and New commenters, Subscribers and Buyers are distinct Contacts; attribution follows the Contact whatever email was used. Outbound events carry an opaque `contact_id`.
- 30 day rule kept intact (Q-24): the commenter's channel id is confirmed with YouTube every 30 days (comments.list by id, 1 unit per 50, from 5 days before it is due) or deleted; wiped at disconnect; never leaves the app. A legal way to recognise people longer is parked as L-01 for a later review. Privacy draft updated.
- Not built yet: a Contact page with the timeline in the app, the merge undo tool (the data for it is logged), open questions O-1 to O-6 (defaults are built).

## Phase 13: what was built

- Design source: `design-system/shine/` (BRAND-GUIDE.md, tokens.css, VidRev App v3.dc.html). Light theme only, fuchsia primary, blue-green live accent, ink secondary, warm danger, Open Sans, dot-grid ground. Visual only: no business logic, routes or copy changed (UI words Comment, Subscriber, Buyer, Revenue).
- Tokens in `src/app/globals.css`; components in `src/components/ui` (Button with the pulsing primary, Badge tones, Keyword, IntentTag, Eyebrow, Card focus and hero, Input, Select, Textarea, Field, Table, Page, PageHeader, PublicCard, EmptyState, Skeleton). `src/app/ui.tsx` no longer holds inline styles.
- Shells: `src/components/shell` (AppShell with hairline header, underline tabs and the phone bottom tab bar; PublicShell), applied through `layout.tsx` of `/app`, `/admin`, `/login`, `/audit`, `/connect`, `/auth`.
- Pages restyled one PR each: /app, /app/queue, /app/campaigns, /app/reports, /app/domain, /app/cancel, /app/integrations, /admin, /login, /auth/verify, /audit, /audit/[id], /connect/crm. `src/app/page.tsx` content kept.
- Micro-interactions (`src/components/motion`): CountUp with num-pop, toast, card-in, quota bar with a bump, copy feedback, skeleton loading, radar empty state; all off under `prefers-reduced-motion`. Not built: the Live activity feed of the design (needs a new data source).
- Brand rule 9: the name is always lowercase, `vidrev`; wordmark "vid" in ink, "rev" in primary; PRODUCT_NAME default is `vidrev`. Logo 1a (512x512, `public/vidrev-logo.png`, `src/app/icon.png`).
- Local check recipe: embedded Postgres (npm `embedded-postgres`, outside the repo), `npx tsx --env-file=.env src/scripts/migrate.ts`, seed a session and demo rows, `next start`, browser at 390 and 1280.

## Phase 12: what was built

- `npm run launch:check` (`src/lib/launch-check.ts`): lists missing or wrong production settings by name (never values), warns when the app is not on `app.<brand domain>` over https; exit 1 until launch ready. Run with `railway run --service web npm run launch:check`.
- `npm run quota:report -- 14` (`src/lib/quota-sizing.ts`): units per method and per connected channel from the real `quota_ledger`, projection for 13/50/100/250 channels, suggested request with 30% headroom, for [docs/compliance/QUOTA-EXTENSION.md](docs/compliance/QUOTA-EXTENSION.md).
- Compliance pack updated for Phases 6 to 10: Marketplace install grant and uninstall in the Privacy draft, audit and connector clause in the Terms draft, reviewer answers (Limited Use, retention, logo) in the OAuth pack, one ordered [LAUNCH-CHECKLIST.md](docs/compliance/LAUNCH-CHECKLIST.md).
- Retention audit: every YouTube-derived table is covered by the daily job (comments, videos, reply ids, commenter identities, channel titles, audit examples) plus delivery logs and expired Marketplace grants; no gap found.
- Logo (owner choice, 2026-09-26): Gemini design, one blue play-triangle mark with the rising arrow, exactly 512x512, uploaded to the HighLevel Marketplace listing. Files in `docs/brand/` (JPG as uploaded, PNG 512, PNG 120 for the Google consent screen). Earlier variants had a checkerboard baked in or a turquoise gradient.
- Not submitted: Google verification and the quota request (LLC), Public review of the HighLevel app.

## Phase 10: what was built

- One-click install from the Marketplace listing (`src/app/api/oauth/crm/callback`, `src/server/ghl/install.ts`, `drizzle/0011`): the same callback serves our own Connect button and the listing's Install button. Signed in: connected at once. Signed out: the grant waits 24 hours in `ghl_installs` (sealed, claim token hash, cookie `ghl_claim` in the installer's browser) and a signed-in account claims it on `/connect/crm` or from the banner on the dashboard and Integrations page. A reinstall of a connected location only refreshes the grant in its own account; nobody can move a location. Agency installs are refused. Retention deletes expired grants.
- Workflow action "Find the video behind this contact" (`POST /api/hooks/crm/action`, `src/server/ghl/action.ts`): secret header `X-Vidrev-Key` (`GHL_ACTION_SECRET`), answers `found`, `video_id`, `video_url`, `keyword`, `intent`, `stage`, `opted_in_at` from our own rows, optional note on the contact through the worker (`ghl.note`). The c2c_tid field and the tags were built in Phase 6. No custom trigger (HighLevel does not document firing one); the tags start workflows through the built-in Contact Tag trigger.
- Listing pack: [docs/MARKETPLACE-LISTING.md](docs/MARKETPLACE-LISTING.md) (draft copy, scope justification, portal steps). Choices P10-01 to P10-06 in `DECISIONS.md` section 17.

## Phase 9: what was built

- Public page `/audit` (form, no sign-in) and `/audit/<uuid>` (result, `noindex`): the web service only creates an `audits` row (`drizzle/0010`) and queues `audit.run`; the worker (`src/worker/audit.ts`) reads the channel with the audit project's API key (`src/server/youtube/audit-api.ts`), its own quota (`quota_ledger.gcp_project = "audit"`, `AUDIT_DAILY_LIMIT`, at most 13 units per audit) and follows description links through an SSRF-guarded fetcher (`src/server/audit/fetch-page.ts`).
- Rule-based, no LLM (`src/lib/audit/`): questions and buying signals with reply state, keyword candidates, description link audit (measured, own domain), stack detection with the 03 research signatures (GoHighLevel only on the creator's own page), Comment Conversion Score with its factors, 3-finding instant preview. Real numbers only; a factor without data is left out.
- Full report by email (`src/server/audit/report.ts`, template in `src/server/email/templates.ts`): sent only to the address entered, marketing consent is a separate unchecked box stored with its time; 3 reports a day per address; optional Turnstile; 5 audits an hour per address; 24h cache per channel (a hit costs no quota).
- Comment text is never stored. API-derived pointers, titles and links (`audits.examples`) and the channel id are wiped 30 days after they were read (retention job); counts, score and requester stay. `/admin` shows requests, reports, consent and the audit quota.
- Owner setup: [docs/SETUP-AUDIT.md](docs/SETUP-AUDIT.md). Choices P9-01 to P9-12 in `DECISIONS.md` section 16.

## Phase 8: what was built

- Stripe (`src/lib/stripe.ts`, `src/server/stripe/`, `src/worker/stripe.ts`): the creator pastes a restricted read-only `rk_live_` key on `/app/integrations` (secret and test keys refused, stored encrypted, only the last 4 shown). The worker reads successful charges every 5 minutes with a pinned API version (`2024-06-20`), records refunds and subscription renewals, resolves buyers to Contacts by email, tid and Stripe customer id, imports 730 days quietly (no events for sales older than 3 days), and Stripe is the canonical source when a sale also arrives from GHL or a webhook. A refused key sets the connection to error and emails the creator once.
- Creator guide: [docs/SETUP-STRIPE.md](docs/SETUP-STRIPE.md). Choices P8-01 to P8-09 in `DECISIONS.md` section 15. No owner setup exists for Stripe.

## Phase 7: what was built

- Attribution (`src/lib/attribution.ts`, `src/server/attribution.ts`, `drizzle/0006`): canonical purchase across sources (same buyer, currency and amount within 72 h; Stripe, then GHL, then webhook), last touch within 180 days (own `c2c_tid` first, else the latest attributed opt-in of the email), renewals follow the first payment for life, net = amount minus refunds. Recomputed per account by the worker after every event or refund.
- Reports (`src/lib/report.ts`, `src/server/reports.ts`, `drizzle/0007`): snapshots per period (this month, last 7, 30, 90 days, all time) in the account's time zone; funnel Comments, Replies, Clicks, Subscribers, Buyers, Revenue; tables per video, keyword, reply template, intent and reply speed; other currencies listed, never converted; buyers without amount shown as "revenue not reported".
- Headline on `/app` and `/app/reports` (Q-09): this month and lifetime, recurring part, subscription share and multiple (founding: 8.08 USD a month). Report settings: time zone, reporting currency (automatic follows GHL), weekly email.
- Emails (`src/worker/notifications.ts`, `drizzle/0008`): weekly summary Monday 9:00 local, milestones (first click, subscriber, buyer), renewal recap for yearly plans 14 days before. `/app/cancel` before cancelling.
- Choices P7-01 to P7-14 in `DECISIONS.md` section 12.

## Phase 6: what was built

- Schema (`drizzle/0005`): `integrations`, `outbound_deliveries` (outbox), `inbound_hook_secrets`, `subscribers`, `purchases`.
- Outbound webhooks (`src/worker/webhooks.ts`, `src/server/integrations/`): HMAC `X-Signature: sha256=<hex>`, `X-Event-Id`, retries for about 22 hours, SSRF guard, events `comment_matched`, `reply_posted`, `link_clicked`, `opt_in`, `purchase`, tag scheme `c2c`, `c2c_kw_<keyword>`, `c2c_vid_<videoId>`, `c2c_buyer` in every payload. UI on `/app/integrations`.
- Universal inbound hooks: `POST /api/hooks/optin` and `/api/hooks/purchase` (token, optional HMAC, JSON or form, idempotent, refunds, buyers without amount). Guide for creators: [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md).
- GoHighLevel connector (`src/server/ghl/`, `src/worker/ghl.ts`): location OAuth with rotating refresh tokens under a row lock, `c2c_tid` field, 5 minute sync of contacts, won opportunities and payments, Ed25519 verified marketplace webhooks, attributed contacts upserted and tagged through the same outbox. Owner steps: [docs/SETUP-GHL.md](docs/SETUP-GHL.md).
- Choices P6-01 to P6-14 in `DECISIONS.md` section 11.

## Phase 5: what was built

- Brand domain **vidrev.app** (on Cloudflare): fallback links `go.vidrev.app`, CNAME target `customers.vidrev.app`.
- Schema (`drizzle/0003`, `0004`): `links` (reply and static, globally unique 7-char slugs), `clicks` (every click, first-party), `custom_domains`, `replies.link_id`, `accounts.fallback_links_blocked`.
- Redirect (`src/proxy.ts`, `src/app/r/[slug]`, `src/server/links.ts`): host routing via `X-Original-Host`; 302 to the campaign destination with `c2c_tid` + UTM; first-party cookie on the creator's domain; bots logged without tid; suspended accounts redirect unmeasured; kill switch for the fallback host.
- Replies post the tracked link (API and "Copy reply"); a posted link never changes host. Static links per keyword and per video on `/app/campaigns`.
- `/app/domain`: subdomain pre-filled from the destination, one CNAME, DNS provider hint by NS lookup, "send to my web person", Check now, Remove; Domain Connect button once a provider supports our template. Worker: DoH CNAME check + Cloudflare custom hostname (HTTP DCV), live email.
- `/c2c.js`: optional opt-in page helper that fills `c2c_tid` fields (CC-07 layer 3).
- Choices P5-01 to P5-10 in `DECISIONS.md` section 9. Phase 4 details: git history and DECISIONS section 7.

## How to test

1. Owner setup below, then open `https://go.vidrev.app/abcdefg`: "This link does not exist." means routing works.
2. `/app/campaigns` shows a `go.vidrev.app/...` link per keyword; opening it lands on the opt-in page with `c2c_tid` and `utm_*`.
3. `/app/domain`: add a subdomain of another domain you own, add the CNAME; within minutes "Live" plus an email; new replies use it.
4. Automated: more than 380 tests (Postgres integration included) pass in CI.
5. Phase 6: `/app/integrations`: add an endpoint (for example a webhook.site address), Send test event, click a tracked link and see `link_clicked` arrive; POST to `/api/hooks/optin` with the token and a `c2c_tid` from a click; connect GoHighLevel after the owner setup.
6. Phase 9: open `/audit`, enter a channel (with `YT_API_KEY_AUDIT` set); the result page shows up to 3 findings within seconds, the email form sends the full report. Without the key the page says the audit is not available.
8. Phase 10: with the Private app, sign out, open the install link from the Marketplace developer portal (or the listing), install on a sub-account: you land on `/connect/crm`; sign in in the same browser and press "Connect to this account". Signed in, the same install connects at once. Set `GHL_ACTION_SECRET`, add the action in the portal (docs/SETUP-GHL.md section 6) and run it in a workflow on a traced contact.
7. Phase 7: open `/app/reports`; the snapshot appears within a minute. Click a tracked link, POST an opt-in with that `c2c_tid` and a purchase with the same email to `/api/hooks/purchase` (see docs/INTEGRATIONS.md): within a minute the funnel shows the click, subscriber, buyer and revenue on the right video and keyword, and the first-click email arrives.

## Owner setup

Done: Railway secrets, GCP project `c2c-app`, OAuth client, channel connected.

Phase 9 Audit my channel **to do** ([docs/SETUP-AUDIT.md](docs/SETUP-AUDIT.md)): new GCP project `vidrev-audit` with the YouTube Data API enabled, an API key restricted to that API, `YT_API_KEY_AUDIT` (and `AUDIT_DAILY_LIMIT=10000`) on both Railway services. Optional: Cloudflare Turnstile keys on `web`. Then run one audit of your own channel and compare the numbers with YouTube Studio.

Phase 10 GoHighLevel Marketplace **to do**: (1) try both install paths on your own sub-account (see How to test 8); (2) optional workflow action: `GHL_ACTION_SECRET` on both Railway services and the action in the developer portal (docs/SETUP-GHL.md section 6); (3) when the LLC exists: fill the listing ([docs/MARKETPLACE-LISTING.md](docs/MARKETPLACE-LISTING.md)) and press "Start Public review" together with the Google verification pack.

Phase 6 GoHighLevel **done 2026-09-25**: Private Marketplace app `vidrev` (target user Sub-account, install by Everyone, White-label listing), keys on both Railway services, Sub-account YTC2C connected, `c2c_tid` field created, syncs run without errors ([docs/SETUP-GHL.md](docs/SETUP-GHL.md)). Still to try with real data: a tracked click through an opt-in form into a tagged contact, a payment and a won opportunity.

Phase 5 Cloudflare setup **done 2026-09-25** ([docs/SETUP-CLOUDFLARE.md](docs/SETUP-CLOUDFLARE.md)): DNS, Cloudflare for SaaS, Worker `steep-cake-5ab6vidrev-links` on `*/*`, API token, Railway variables. `https://go.vidrev.app/<slug>` is live.

Still deferred from Phase 4 (no billing yet): platform Gemini key and `WEBSUB_SECRET`, see DECISIONS section 8.

## Open issues

- End-to-end run on the owner's channel not done yet (needs the setup above).
- Audit my channel: built and tested against a fake YouTube API and fake pages only. To confirm with the first real audit: that `commentThreads.list` returns the creator's replies for threads with few replies (the "unanswered" numbers rely on it), that description links resolve, and that the stack finding names the right system. The buying-signal patterns are English only.
- Audit my channel: not built are the 30 day re-audit reminder with score history (P9-12), delivery of audit opt-ins to the owner's CRM (they are listed in `/admin`), and a web copy of the full report (the email is the gate). Privacy draft updated for audit data; the audit's use of YouTube API data (public data, API key, pointers only) should be re-checked with the Google verification pack.
- Audit page depends on the Railway `web` service handling the form post from the app host; the in-memory rate limit is per instance (fine for one instance).
- Brand domain vidrev.app bought; still to do: Resend sending domain, `app.vidrev.app` for the app and OAuth (compliance pack), so OAuth stays in Testing mode (reconnect weekly) until then.
- First real custom domain (a creator's own subdomain) not tried yet; Cloudflare for SaaS hostname creation is covered by tests with a faked API only.
- Domain Connect goes live per provider only after the template PR and provider onboarding ([docs/domain-connect/README.md](docs/domain-connect/README.md)); name is lowercase `vidrev` (P5-09).
- Queue page mints reply links on render (one query set per open draft); fine for now, batch it if queues grow.
- GoHighLevel: connection, setup and the three reads (contacts, won opportunities, payments) ran without HTTP errors on the YTC2C Sub-account; the account holds no real payments yet, so amount units and refunds (docs/SETUP-GHL.md section 5) are confirmed only by the first real payment.
- Hosted opt-in fallback (SPEC section 9) is not built (P6-13, P7-14); build it when a creator without a CRM appears.
- `standard_monthly` has no price yet, so its headline shows no subscription share; set `price_cents` and `price_currency` in the plans table once the price is decided.
- Report refresh reads all rows of one account at once; fine for the founding cohort, move to incremental aggregates if an account grows past tens of thousands of clicks.
- `BILLING_PORTAL_URL` (GHL customer portal) is not set yet; `/app/cancel` then tells creators to use their receipt email.
- Weekly and milestone emails go through Resend; the sending domain is still to be set up (see below).
- Outbound `link_clicked` volume is unbounded per click; add a per-endpoint rate cap if a creator's endpoint struggles.
- Owner questions O-1 to O-6 on Contacts (DECISIONS 13.12) and the parked review L-01 (13.13); the recommended defaults are built.
- Stripe: the connector is tested against a fake Stripe only. What a real payment must confirm: a restricted key with read on Charges, Customers and Invoices can list charges with the two expansions, and whether it may read `/v1/account` (the name; optional).
- The Contact page (timeline) and the merge undo tool are not built; a report shows people counts only.
- Still open: Q-01 (name and domain). GHL merge field names in the provisioning guide must be checked when the workflows are built.
- Phase 10: built and tested against a fake HighLevel only. To confirm live: that the Marketplace Install button reaches the callback with a `code` and no `state` (the assumed contract), that HighLevel accepts the header setup of the workflow action and the note endpoint (`POST /contacts/{id}/notes`, marked "verify live"), and the Public review itself (needs the LLC). A waiting install lives in the installer's browser cookie for 24 hours: signing in from a different browser or device does not find it, the installer installs again. The GHL sync and note jobs do not check for a suspended account (a pre-existing behaviour of Phase 6).
- Proposals P10-01 to P10-06, P9-01 to P9-12, P8-01 to P8-09, P8-C-01 to P8-C-05 and CC-01 to CC-06, P3-01 to P3-07, P4-01 to P4-11 and P5-01 to P5-12 and P6-01 to P6-14 and P7-01 to P7-14 in `DECISIONS.md` await owner review (P4-10 accepted 2026-09-25; owner data principle in DECISIONS section 8).
- Poll jobs run one at a time per worker; fine for the founding cohort, revisit with many channels.
- Railway did not run the config-as-code pre-deploy command; migrations run at service start instead.
- `drizzle-kit` pulls a dev-only dependency with a moderate npm audit advisory; not shipped.
- Drive doc 00 Index still says "decisions D-01...D-12" (Drive housekeeping).

## Next phase

None scheduled (Phase 11 was removed, Q-25). Owner work first: [docs/compliance/LAUNCH-CHECKLIST.md](docs/compliance/LAUNCH-CHECKLIST.md) section A, plus the Phase 9 and 10 setup above. A proposed UI restyle to Tailwind CSS and shadcn/ui in the brand design-system (owner asked 2026-09-26) is not started; it needs "mehet". In parallel, once the LLC exists: fill the compliance placeholders and submit (docs/compliance/README.md), and press "Start Public review" for the HighLevel app.
