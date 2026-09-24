# STATUS

Last updated: 2026-09-25

## End goal

A production SaaS that turns keyword comments into subscribers, buyers and revenue, attributed per video and keyword, with tracked links on the creator's own domain and approval-only replies. See [docs/PRD.md](docs/PRD.md) and [docs/SPEC.md](docs/SPEC.md).

## Phases

| # | Phase | Status |
| --- | --- | --- |
| 0 | Bootstrap: repo docs, decisions, PRD, SPEC, .gitignore, .env.example | **DONE** (2026-09-25) |
| 1 | SPEC review: gaps, risks, owner decisions, proposed fixes | **DONE** (2026-09-25), answers to Q-01 to Q-22 pending |
| 2 | Scaffold and deploy: app skeleton, Postgres, migrations, health check, CI, Railway project `c2c-saas`, first deploy | next, waiting for owner approval ("mehet") |
| 3 | Accounts: magic-link login, provisioning webhook, plans and seeds, OAuth connect with encrypted tokens | not started |
| 4 | Comment engine: channel polling tiers, PubSubHubbub, keyword rules, AI drafts, templates, approval queue, quota-budget scheduling, transparent queue, manual fallback, quota ledger | not started |
| 5 | Tracked links on the user's own domain: CNAME onboarding, DNS check, Cloudflare for SaaS TLS, fallback domain, click ids, mapping | not started |
| 6 | Integrations: outbound HMAC webhooks and tags, GHL OAuth, inbound opt-in and purchase webhooks | not started |
| 7 | Attribution and reporting | not started |
| 8 | Stripe revenue ingestion (read-only, Stripe Connect) | not started |
| 9 | Audit my channel | not started |
| 10 | GHL Marketplace connector | not started |
| 11 | Enterprise BYOK | not started |
| 12 | Compliance and launch readiness | not started |

Proposed phase plan changes (Q-17, pending): compliance pack and quota extension request right after Phase 5; the retention job in Phase 4; one GHL Marketplace app created in Phase 6 and listed publicly in Phase 10; a Cloudflare for SaaS spike in Phase 2 if a test domain exists.

## Phase 1: what was built

- `docs/SPEC-REVIEW.md`: 8 top findings, 30+ findings (R-xx) with severity and proposed fix, 22 owner questions (Q-01 to Q-22) each with a recommendation, and the verified external facts used.
- D-37 (pricing: 29/49/99 rejected, 14-day trial with card, no forever-free plan, standard price configurable) merged into `DECISIONS.md`, `docs/PRD.md` and `docs/SPEC.md`.
- `docs/SPEC.md` is otherwise unchanged; accepted fixes are merged into it at the start of Phase 2.

## How to test

Documentation only. Read `docs/SPEC-REVIEW.md` sections 1 and 3.

## Open issues

- Owner answers to Q-01 to Q-22 (docs/SPEC-REVIEW.md section 3). Input needed on Q-01 (name and domain, before Phase 5 go-live), Q-15 (test domain), Q-16 (founding trial), Q-22 (GHL DNS fingerprint).
- Proposals CC-01 to CC-06 in `DECISIONS.md` still pending.
- Drive doc 00 Index still says "decisions D-01...D-12" (Drive housekeeping). In Drive 02, D-13 onwards stays a bullet list on purpose (owner, 2026-09-25: Drive tables format badly).

## Next phase

Phase 2: scaffold and deploy. Starts only after "mehet". Needs: Railway CLI logged in on this machine.
