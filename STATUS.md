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
| 3 | Accounts: magic-link login, provisioning webhook, plans and seeds, OAuth connect with encrypted tokens | **DONE** (2026-09-25); verified end to end on 2026-09-25 |
| 4 | Comment engine: channel polling tiers, PubSubHubbub, keyword rules, AI drafts, templates, approval queue, quota-budget sending, transparent queue, manual fallback, quota ledger, retention job | **DONE** (2026-09-25), PRs #2 to #7; end-to-end check on the owner's channel pending (owner setup below) |
| 5 | Tracked links on the user's own domain: CNAME onboarding, DNS check, Cloudflare for SaaS TLS, fallback domain, click ids, mapping | next, waiting for owner approval ("mehet") |
| 6 | Integrations: outbound HMAC webhooks and tags, GHL OAuth, inbound opt-in and purchase webhooks | not started |
| 7 | Attribution and reporting | not started |
| 8 | Stripe revenue ingestion (read-only; Stripe App or restricted key, Q-17 e) | not started |
| 9 | Audit my channel | not started |
| 10 | GHL Marketplace connector | not started |
| 11 | Enterprise BYOK | not started |
| 12 | Compliance and launch readiness | not started |

Phase plan changes (all accepted): compliance pack and quota extension request right after Phase 5 (Q-17 a); one GHL Marketplace app created Private in Phase 6 and made Public in Phase 10 (Q-17 b); retention job in Phase 4 (Q-17 c, done); Cloudflare for SaaS spike once the brand domain exists (Q-17 d).

## Phase 4: what was built

- Schema (`drizzle/0002_comment_engine.sql`): `videos`, `campaigns` (keyword, aliases, HOT/WARM/COLD intent, destination URL, optional video scope), `templates` (per campaign and language), `comments` (matching top-level comments only), `replies` (draft to sent), polling state on `channels`, AI settings on `accounts`, `app_settings` with `reply_reserve_pct` = 75.
- Polling (`src/worker/polling.ts`): one `commentThreads.list allThreadsRelatedToChannelId` per channel, paged to the last processed comment, tiers 2 / 15 / 60 min with one global stretch factor. Only active channels (enabled campaign, active account). The creator's own comments and thread replies never trigger.
- Upload detection: WebSub push at `/api/websub` (HMAC per channel, lease renewed hourly) and the free RSS feed every 15 min while no lease is live; a new upload switches the channel to 2 min for 48h.
- Quota (`src/server/quota.ts`, `src/lib/quota.ts`): units charged in `quota_ledger` before every call; reads use at most 25% of the day, replies the rest.
- Drafts (`src/worker/drafts.ts`): whole-word keyword match, best intent wins, others switchable; language cascade; platform Gemini (`gemini-3.1-flash-lite`, about 0.0003 USD per draft) or the account's own Anthropic, OpenAI or Gemini key; template fallback; the commenter's name is never sent; "replies waiting" email at most hourly.
- Approval and sending: `/app/queue` (mobile, one draft at a time, optimistic, no bulk), approve checks template rules and caps (300 a month, 30 a day), sent after 30 to 180 s jitter when the day's budget allows, otherwise queued and sent first after the midnight Pacific reset (round robin by account); waiting list with estimated time, the honest YouTube-limit note and "Copy reply and open comment" (0 units). Until Phase 5 the reply carries the campaign's destination URL.
- `/app/campaigns`: keywords, templates per language, default reply language, AI provider and key (encrypted).
- Retention (`src/worker/retention.ts`, daily 10:30 UTC): YouTube data older than 30 days deleted, channel titles refreshed, unapproved drafts expire after 30 days; disconnect or revoke wipes the channel's YouTube data at once.
- Choices P4-01 to P4-11 in `DECISIONS.md` section 7.

## How to test

1. Owner setup (below), then sign in at `https://web-production-7b0e1f.up.railway.app/login`.
2. On `/app/campaigns`, add a keyword (for example `guide`) with your opt-in page URL and a template such as `Here you go: {link}`.
3. From another Google account, comment `guide please` under one of your videos. Within 15 minutes (2 minutes after a fresh upload) the draft appears on `/app/queue` and an email arrives.
4. Approve it: the reply appears under the comment after 30 to 180 seconds. Try "Skip" and "Copy reply and open comment" on another one.
5. Automated: 121 tests (85 unit, 36 Postgres integration) pass in CI.

## Owner setup

Done 2026-09-25: Railway secrets, GCP project `c2c-app`, OAuth client, channel connected.

New for Phase 4 (**deferred by the owner until the brand domain is bought; no billing before that**). When it is time, Claude writes click-by-click steps with paste-ready URLs, like [docs/SETUP-GOOGLE.md](docs/SETUP-GOOGLE.md). Until then drafts come from the approved templates (no AI).

1. Create a separate GCP project for the platform AI key (never `c2c-app`), enable billing and the Gemini API, create an API key restricted to the Generative Language API.
2. Run `scripts/set-secrets.ps1` again: it generates `WEBSUB_SECRET` and asks for `GEMINI_PLATFORM_API_KEY` (Enter skips; drafts then use templates only).
3. Push to `main` or redeploy both services.

## Open issues

- End-to-end run on the owner's channel not done yet (needs the setup above).
- Brand domain not bought yet: Resend sends only to the owner inbox; OAuth stays in Testing mode (reconnect weekly); Cloudflare spike waits (Q-15). `APP_BASE_URL` must be the public https URL for WebSub; until then RSS covers upload detection.
- Still open: Q-01 (name and domain). GHL merge field names in the provisioning guide must be checked when the workflows are built.
- Proposals CC-01 to CC-06, P3-01 to P3-07 and P4-01 to P4-11 in `DECISIONS.md` await owner review (P4-10 accepted 2026-09-25; owner data principle in DECISIONS section 8).
- Poll jobs run one at a time per worker; fine for the founding cohort, revisit with many channels.
- Railway did not run the config-as-code pre-deploy command; migrations run at service start instead.
- `drizzle-kit` pulls a dev-only dependency with a moderate npm audit advisory; not shipped.
- Drive doc 00 Index still says "decisions D-01...D-12" (Drive housekeeping).

## Next phase

Phase 5: tracked links on the user's own domain (CNAME onboarding with DNS check, Cloudflare for SaaS TLS, fallback domain, click ids, campaign/video/keyword mapping; replies switch from the destination URL to the tracked link). Starts only after "mehet".
