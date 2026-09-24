# STATUS

Last updated: 2026-09-25

## End goal

A production SaaS that turns keyword comments into subscribers, buyers and revenue, attributed per video and keyword, with tracked links on the creator's own domain and approval-only replies. See [docs/PRD.md](docs/PRD.md) and [docs/SPEC.md](docs/SPEC.md).

## Phases

| # | Phase | Status |
| --- | --- | --- |
| 0 | Bootstrap: repo docs, decisions, PRD, SPEC, .gitignore, .env.example | **DONE** (2026-09-25) |
| 1 | SPEC review: gaps, risks, owner decisions, proposed fixes | next, waiting for owner approval ("mehet") |
| 2 | Scaffold and deploy: app skeleton, Postgres, migrations, health check, CI, Railway project `c2c-saas`, first deploy | not started |
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

## Phase 0: what was built

- `README.md`: product in one paragraph, file map, stack, ground rules.
- `DECISIONS.md`: all valid decisions D-01 to D-36 from Drive doc 02 (translated, with valid/refined/superseded status), build brief decisions B-01 to B-09, proposals CC-01 to CC-06, open questions.
- `docs/PRD.md`: Drive doc 04 translated; superseded points flagged inline, not rewritten.
- `docs/SPEC.md`: Drive doc 05 with every UPDATE and APPROVED note merged into the text it overrides; the WITHDRAWN Python stack proposal removed.
- `.gitignore`, `.env.example` (every env var from the SPEC plus the CC-01, CC-03, CC-06 additions).

## How to test

Documentation only. Read `DECISIONS.md` section 3 (proposals) and check the flagged points in `docs/PRD.md`.

## Open issues

- Proposals CC-01 to CC-06 in `DECISIONS.md` are pending owner approval.
- Drive doc 00 Index still says "decisions D-01...D-12"; 02 goes up to D-36 (Drive housekeeping, not a code issue).
- In Drive doc 02, decisions D-13 to D-36 sit inside the "Open questions" list rather than the decisions table; treated as valid decisions here.
- 04 PRD pricing (Starter/Pro/Scale) versus the plan list in the build brief: to reconcile in Phase 1.

## Next phase

Phase 1: critical SPEC review (gaps, risks, every owner decision needed, proposed fixes). Starts only after "mehet".
