# STATUS

Last updated: 2026-09-25 (Phase 6)

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
| 6 | Integrations: outbound HMAC webhooks and tags, GHL OAuth, inbound opt-in and purchase webhooks | **DONE** (2026-09-25), PRs #13 to #15; GHL live check pending the Private Marketplace app (owner setup below) |
| 7 | Attribution and reporting | not started |
| 8 | Stripe revenue ingestion (read-only; Stripe App or restricted key, Q-17 e) | not started |
| 9 | Audit my channel | not started |
| 10 | GHL Marketplace connector | not started |
| 11 | Enterprise BYOK | not started |
| 12 | Compliance and launch readiness | not started |

Phase plan changes (all accepted): compliance pack and quota extension request right after Phase 5 (Q-17 a); one GHL Marketplace app created Private in Phase 6 and made Public in Phase 10 (Q-17 b); retention job in Phase 4 (Q-17 c, done); Cloudflare for SaaS spike once the brand domain exists (Q-17 d).

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
4. Automated: 272 tests (Postgres integration included) pass in CI.
5. Phase 6: `/app/integrations`: add an endpoint (for example a webhook.site address), Send test event, click a tracked link and see `link_clicked` arrive; POST to `/api/hooks/optin` with the token and a `c2c_tid` from a click; connect GoHighLevel after the owner setup.

## Owner setup

Done: Railway secrets, GCP project `c2c-app`, OAuth client, channel connected.

Phase 6 GoHighLevel: create the Private Marketplace app and set `GHL_CLIENT_ID` and `GHL_CLIENT_SECRET` with `scripts/set-secrets.ps1 -Ghl` ([docs/SETUP-GHL.md](docs/SETUP-GHL.md)). Until then the button says "not available yet" and everything else in Phase 6 works.

Phase 5 Cloudflare setup **done 2026-09-25** ([docs/SETUP-CLOUDFLARE.md](docs/SETUP-CLOUDFLARE.md)): DNS, Cloudflare for SaaS, Worker `steep-cake-5ab6vidrev-links` on `*/*`, API token, Railway variables. `https://go.vidrev.app/<slug>` is live.

Still deferred from Phase 4 (no billing yet): platform Gemini key and `WEBSUB_SECRET`, see DECISIONS section 8.

## Open issues

- End-to-end run on the owner's channel not done yet (needs the setup above).
- Brand domain vidrev.app bought; still to do: Resend sending domain, `app.vidrev.app` for the app and OAuth (compliance pack), so OAuth stays in Testing mode (reconnect weekly) until then.
- First real custom domain (a creator's own subdomain) not tried yet; Cloudflare for SaaS hostname creation is covered by tests with a faked API only.
- Domain Connect goes live per provider only after the template PR and provider onboarding ([docs/domain-connect/README.md](docs/domain-connect/README.md)); name is lowercase `vidrev` (P5-09).
- Queue page mints reply links on render (one query set per open draft); fine for now, batch it if queues grow.
- GoHighLevel API details marked "verify live" (docs/SETUP-GHL.md section 5) are confirmed only on the first real connection.
- Hosted opt-in fallback (SPEC section 9) is not built (P6-13); Phase 7 or later.
- Outbound `link_clicked` volume is unbounded per click; add a per-endpoint rate cap if a creator's endpoint struggles.
- Still open: Q-01 (name and domain). GHL merge field names in the provisioning guide must be checked when the workflows are built.
- Proposals CC-01 to CC-06, P3-01 to P3-07, P4-01 to P4-11 and P5-01 to P5-12 and P6-01 to P6-14 in `DECISIONS.md` await owner review (P4-10 accepted 2026-09-25; owner data principle in DECISIONS section 8).
- Poll jobs run one at a time per worker; fine for the founding cohort, revisit with many channels.
- Railway did not run the config-as-code pre-deploy command; migrations run at service start instead.
- `drizzle-kit` pulls a dev-only dependency with a moderate npm audit advisory; not shipped.
- Drive doc 00 Index still says "decisions D-01...D-12" (Drive housekeeping).

## Next phase

Phase 7: attribution and reporting (opt-in and purchase matching by email and tracking id, last touch within 180 days, recurring payments follow the first purchase, refunds, duplicates across sources linked to one canonical purchase, dashboard per video and keyword, headline sentence). Starts only after "mehet". In parallel, once the LLC exists: fill the compliance placeholders and submit (docs/compliance/README.md).
