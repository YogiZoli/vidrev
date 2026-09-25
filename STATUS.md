# STATUS

Last updated: 2026-09-25

## End goal

A production SaaS that turns keyword comments into subscribers, buyers and revenue, attributed per video and keyword, with tracked links on the creator's own domain and approval-only replies. See [docs/PRD.md](docs/PRD.md) and [docs/SPEC.md](docs/SPEC.md).

## Phases

| # | Phase | Status |
| --- | --- | --- |
| 0 | Bootstrap: repo docs, decisions, PRD, SPEC, .gitignore, .env.example | **DONE** (2026-09-25) |
| 1 | SPEC review: gaps, risks, owner decisions, proposed fixes | **DONE** (2026-09-25); answers in DECISIONS sections 5 and 6 |
| 2 | Scaffold and deploy: app skeleton, Postgres, migrations, health check, CI, Railway project `c2c-saas`, first deploy | **DONE** (2026-09-25) |
| 3 | Accounts: magic-link login, provisioning webhook, plans and seeds, OAuth connect with encrypted tokens | **DONE** (2026-09-25); end-to-end check waits on the owner setup below |
| 4 | Comment engine: channel polling tiers, PubSubHubbub, keyword rules, AI drafts, templates, approval queue, quota-budget scheduling, transparent queue, manual fallback, quota ledger, retention job | next, waiting for owner approval ("mehet") |
| 5 | Tracked links on the user's own domain: CNAME onboarding, DNS check, Cloudflare for SaaS TLS, fallback domain, click ids, mapping | not started |
| 6 | Integrations: outbound HMAC webhooks and tags, GHL OAuth, inbound opt-in and purchase webhooks | not started |
| 7 | Attribution and reporting | not started |
| 8 | Stripe revenue ingestion (read-only; Stripe App or restricted key, Q-17 e) | not started |
| 9 | Audit my channel | not started |
| 10 | GHL Marketplace connector | not started |
| 11 | Enterprise BYOK | not started |
| 12 | Compliance and launch readiness | not started |

Phase plan changes (all accepted): compliance pack and quota extension request right after Phase 5 (Q-17 a); one GHL Marketplace app created Private in Phase 6 and made Public in Phase 10 (Q-17 b); retention job in Phase 4 (Q-17 c); Cloudflare for SaaS spike once the brand domain exists (Q-17 d).

## Phase 3: what was built

- Schema and seeds: `plans` (300 replies per month and 30 per day on every plan, 1 channel; founding 97 USD/year with 100 seats; enterprise and internal without a monthly cap), `accounts`, `users`, `sessions`, `magic_link_tokens`, `provisioning_events`, `channels`, `quota_ledger`, `audit_log`. Plans and owner accounts (`ADMIN_EMAILS`, internal plan) are seeded at every start, idempotently.
- Magic-link login: single use, 15 minutes, stored hashed, 5 requests per 15 minutes per user, consumed on POST only (mail scanners), 30-day session cookie, Origin check on form posts. Emails are sent by the worker through Resend.
- GHL provisioning webhook `POST /api/provisioning/ghl`: Bearer secret, optional HMAC, idempotent on (event, external_id), trial, plan change, suspension guarded by subscription id, reactivation, founding seat alerts at 90 and 100. Guide: [docs/GHL-PROVISIONING.md](docs/GHL-PROVISIONING.md).
- Google OAuth channel connect: only `openid email profile youtube.force-ssl`, PKCE, offline access, AES-256-GCM encrypted tokens. The worker resolves the channel with `channels.list` (1 unit, written to `quota_ledger`), rejects channels already live elsewhere, handles revoked grants; disconnect revokes at Google and deletes the channel's YouTube data at once. Setup: [docs/SETUP-GOOGLE.md](docs/SETUP-GOOGLE.md).
- Pages: `/login`, `/auth/verify`, `/app` (account, plan, channel connect and disconnect), `/admin` (owner: grant access, change plan, suspend, reactivate, founding seats).
- `scripts/set-secrets.ps1` sets the app secrets on both Railway services without printing them.
- DECISIONS: owner answers of 2026-09-25 (75% reply reserve, immediate sending D-31b, platform Gemini key Q-13c, HOT/WARM/COLD priority, reporting and anti-churn features R-35) and Phase 3 choices P3-01 to P3-07. SPEC updated to match.

## How to test

1. Owner setup first (below).
2. Sign in: open `https://web-production-7b0e1f.up.railway.app/login`, enter the owner email, open the emailed link, click Continue. Until a Resend domain is verified, mail goes only to the Resend account owner's address.
3. Connect the channel on `/app`; after a few seconds it shows the channel title and "connected".
4. Provisioning: the PowerShell test in [docs/GHL-PROVISIONING.md](docs/GHL-PROVISIONING.md) creates an account; `/admin` lists it.
5. Automated: 71 tests (49 unit, 22 Postgres integration) pass in CI; `npm test` locally runs the unit tests.

## Owner setup needed before the end-to-end check

1. Run `scripts/set-secrets.ps1` (sets `ENCRYPTION_KEY`, `AUTH_SECRET`, `PROVISIONING_SECRET`).
2. Create the GCP project `c2c-app` and OAuth client ([docs/SETUP-GOOGLE.md](docs/SETUP-GOOGLE.md)), then run the script again to set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
3. Redeploy both services (or push to `main`).
4. Later: build the GHL workflows ([docs/GHL-PROVISIONING.md](docs/GHL-PROVISIONING.md)) once the checkout products exist.

## Open issues

- Brand domain not bought yet: Resend sends only from its test sender (owner inbox only); OAuth stays in Testing mode (refresh tokens expire after 7 days, reconnect weekly); Cloudflare spike waits (Q-15).
- Still open: Q-01 (name and domain). GHL merge field names in the provisioning guide must be checked in the workflow editor when the workflows are built.
- Platform Gemini key (Q-13c): needs its own billing-enabled GCP project and a cost check at the start of Phase 4.
- Railway did not run the config-as-code pre-deploy command; migrations run at service start instead.
- `drizzle-kit` pulls a dev-only dependency with a moderate npm audit advisory; not shipped to production.
- Proposals CC-01 to CC-06 and P3-01 to P3-07 in `DECISIONS.md` await owner review.
- Drive doc 00 Index still says "decisions D-01...D-12" (Drive housekeeping).
- The owner's build brief is in `docs/BUILD-BRIEF.md`; DECISIONS.md overrides it where they differ.

## Next phase

Phase 4: comment engine (channel polling with activity tiers and the 75% reply reserve, PubSubHubbub, keyword rules with HOT/WARM/COLD priority, AI drafts with the platform Gemini key, templates per language, one-by-one approval queue with email notification, immediate sending within budget, transparent queue, manual fallback, quota ledger, 30-day retention job). Starts only after "mehet".
