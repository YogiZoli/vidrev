# STATUS

Last updated: 2026-09-26 (Phase 7)

## End goal

A production SaaS that turns keyword comments into subscribers, buyers and revenue, attributed per video and keyword, with tracked links on the creator's own domain and approval-only replies. See [docs/PRD.md](docs/PRD.md) and [docs/SPEC.md](docs/SPEC.md).

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
| 8 | Stripe revenue ingestion (read-only; Stripe App or restricted key, Q-17 e) | not started |
| 9 | Audit my channel | not started |
| 10 | GHL Marketplace connector | not started |
| 11 | Enterprise BYOK | not started |
| 12 | Compliance and launch readiness | not started |

Phase plan changes (all accepted): compliance pack and quota extension request right after Phase 5 (Q-17 a); one GHL Marketplace app created Private in Phase 6 and made Public in Phase 10 (Q-17 b); retention job in Phase 4 (Q-17 c, done); Cloudflare for SaaS spike once the brand domain exists (Q-17 d).

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
4. Automated: 313 tests (Postgres integration included) pass in CI.
5. Phase 6: `/app/integrations`: add an endpoint (for example a webhook.site address), Send test event, click a tracked link and see `link_clicked` arrive; POST to `/api/hooks/optin` with the token and a `c2c_tid` from a click; connect GoHighLevel after the owner setup.
6. Phase 7: open `/app/reports`; the snapshot appears within a minute. Click a tracked link, POST an opt-in with that `c2c_tid` and a purchase with the same email to `/api/hooks/purchase` (see docs/INTEGRATIONS.md): within a minute the funnel shows the click, subscriber, buyer and revenue on the right video and keyword, and the first-click email arrives.

## Owner setup

Done: Railway secrets, GCP project `c2c-app`, OAuth client, channel connected.

Phase 6 GoHighLevel **done 2026-09-25**: Private Marketplace app `vidrev` (target user Sub-account, install by Everyone, White-label listing), keys on both Railway services, Sub-account YTC2C connected, `c2c_tid` field created, syncs run without errors ([docs/SETUP-GHL.md](docs/SETUP-GHL.md)). Still to try with real data: a tracked click through an opt-in form into a tagged contact, a payment and a won opportunity.

Phase 5 Cloudflare setup **done 2026-09-25** ([docs/SETUP-CLOUDFLARE.md](docs/SETUP-CLOUDFLARE.md)): DNS, Cloudflare for SaaS, Worker `steep-cake-5ab6vidrev-links` on `*/*`, API token, Railway variables. `https://go.vidrev.app/<slug>` is live.

Still deferred from Phase 4 (no billing yet): platform Gemini key and `WEBSUB_SECRET`, see DECISIONS section 8.

## Open issues

- End-to-end run on the owner's channel not done yet (needs the setup above).
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
- Still open: Q-01 (name and domain). GHL merge field names in the provisioning guide must be checked when the workflows are built.
- Proposals CC-01 to CC-06, P3-01 to P3-07, P4-01 to P4-11 and P5-01 to P5-12 and P6-01 to P6-14 and P7-01 to P7-14 in `DECISIONS.md` await owner review (P4-10 accepted 2026-09-25; owner data principle in DECISIONS section 8).
- Poll jobs run one at a time per worker; fine for the founding cohort, revisit with many channels.
- Railway did not run the config-as-code pre-deploy command; migrations run at service start instead.
- `drizzle-kit` pulls a dev-only dependency with a moderate npm audit advisory; not shipped.
- Drive doc 00 Index still says "decisions D-01...D-12" (Drive housekeeping).

## Next phase

Phase 8: Stripe revenue ingestion, read-only (a Stripe App or a creator-provided restricted key, Q-17 e; decided at the start of the phase). Purchases land in the same `purchases` table, so attribution and reports need no change. Starts only after "mehet". In parallel, once the LLC exists: fill the compliance placeholders and submit (docs/compliance/README.md).
