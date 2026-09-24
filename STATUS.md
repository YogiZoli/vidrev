# STATUS

Last updated: 2026-09-25

## End goal

A production SaaS that turns keyword comments into subscribers, buyers and revenue, attributed per video and keyword, with tracked links on the creator's own domain and approval-only replies. See [docs/PRD.md](docs/PRD.md) and [docs/SPEC.md](docs/SPEC.md).

## Phases

| # | Phase | Status |
| --- | --- | --- |
| 0 | Bootstrap: repo docs, decisions, PRD, SPEC, .gitignore, .env.example | **DONE** (2026-09-25) |
| 1 | SPEC review: gaps, risks, owner decisions, proposed fixes | **DONE** (2026-09-25); owner answers recorded in DECISIONS section 5, some still open |
| 2 | Scaffold and deploy: app skeleton, Postgres, migrations, health check, CI, Railway project `c2c-saas`, first deploy | **DONE** (2026-09-25) |
| 3 | Accounts: magic-link login, provisioning webhook, plans and seeds, OAuth connect with encrypted tokens | next, waiting for owner approval ("mehet") |
| 4 | Comment engine: channel polling tiers, PubSubHubbub, keyword rules, AI drafts, templates, approval queue, quota-budget scheduling, transparent queue, manual fallback, quota ledger | not started |
| 5 | Tracked links on the user's own domain: CNAME onboarding, DNS check, Cloudflare for SaaS TLS, fallback domain, click ids, mapping | not started |
| 6 | Integrations: outbound HMAC webhooks and tags, GHL OAuth, inbound opt-in and purchase webhooks | not started |
| 7 | Attribution and reporting | not started |
| 8 | Stripe revenue ingestion (read-only, Stripe Connect) | not started |
| 9 | Audit my channel | not started |
| 10 | GHL Marketplace connector | not started |
| 11 | Enterprise BYOK | not started |
| 12 | Compliance and launch readiness | not started |

Phase plan changes: compliance pack and quota extension request right after Phase 5 (accepted, Q-17 a). Proposed, pending: the retention job in Phase 4; one GHL Marketplace app created in Phase 6 and listed publicly in Phase 10; a Cloudflare for SaaS spike once a domain exists.

## Phase 2: what was built

- Next.js 16 App Router app (`web`): placeholder home page and `GET /api/health` (database check, schema check, worker heartbeat age; 503 if the database or schema is not usable, 200 "degraded" if the worker is stale).
- pg-boss 12 worker (`worker`): per-minute heartbeat job, small HTTP health server, graceful shutdown.
- Drizzle ORM schema and first migration (`worker_heartbeats`). Migrations run at every service start, guarded by a Postgres advisory lock.
- zod env validation (only `DATABASE_URL` required so far), structured JSON logs with error causes.
- CI (GitHub Actions): lint, typecheck, unit tests, Postgres 17 integration tests, build.
- Railway project `c2c-saas` (environment `production`): services `web`, `worker`, `Postgres`, both app services deploy from `main`; docs-only commits do not redeploy (`watchPatterns`). Postgres has no public endpoint.

## How to test

- Live: `https://web-production-7b0e1f.up.railway.app/api/health` should return `{"status":"ok","db":"ok","worker":{"state":"ok",...}}`.
- Locally: see README "Local development" (`npm run lint`, `npm run typecheck`, `npm test`, `npm run build`).
- CI: every push to `main` runs the checks on GitHub Actions.
- Verified 2026-09-25: live health returned `status ok, db ok, worker ok` on version `17edae7`.

## Phase 1: what was built

- `docs/SPEC-REVIEW.md`: 8 top findings, 30+ findings (R-xx) with severity and proposed fix, 22 owner questions (Q-01 to Q-22) each with a recommendation, and the verified external facts used.
- D-37 (pricing: 29/49/99 rejected, 14-day trial with card, no forever-free plan, standard price configurable) merged into `DECISIONS.md`, `docs/PRD.md` and `docs/SPEC.md`.
- `docs/SPEC.md` is otherwise unchanged; accepted fixes are merged into it at the start of Phase 3.

## Open issues

- Still open from the Phase 1 review: Q-01 (name and domain), Q-02, Q-03, Q-10, Q-11, Q-13 (free-tier Gemini compliance check), Q-15 (domain for the Cloudflare spike), Q-17 (b) to (e), Q-18, Q-19, Q-22, CC-07. Answers so far: DECISIONS.md section 5.
- Railway did not run the config-as-code pre-deploy command; migrations therefore run at service start instead. Revisit if Railway config-as-code is confirmed working.
- `drizzle-kit` pulls a dev-only dependency with a moderate npm audit advisory (esbuild via @esbuild-kit); not shipped to production.
- Proposals CC-01 to CC-06 in `DECISIONS.md` still pending.
- Drive doc 00 Index still says "decisions D-01...D-12" (Drive housekeeping). In Drive 02, D-13 onwards stays a bullet list on purpose (owner, 2026-09-25: Drive tables format badly).

- The owner's build brief is stored in `docs/BUILD-BRIEF.md`; DECISIONS.md section 5 overrides it where they differ.

## Next phase

Phase 3: accounts (magic-link login, provisioning webhook, plans and seeds, Google OAuth connect with encrypted tokens, exact steps for the new GCP project and OAuth client). Starts only after "mehet". Needs answers to Q-03 (reply caps) and a Resend account.
