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
| 5 | Tracked links on the user's own domain: CNAME onboarding, DNS check, Cloudflare for SaaS TLS, fallback domain, click ids, mapping | **DONE** (2026-09-25), PRs #8 to #10; goes live after the owner Cloudflare setup (below) |
| 6 | Integrations: outbound HMAC webhooks and tags, GHL OAuth, inbound opt-in and purchase webhooks | not started |
| 7 | Attribution and reporting | not started |
| 8 | Stripe revenue ingestion (read-only; Stripe App or restricted key, Q-17 e) | not started |
| 9 | Audit my channel | not started |
| 10 | GHL Marketplace connector | not started |
| 11 | Enterprise BYOK | not started |
| 12 | Compliance and launch readiness | not started |

Phase plan changes (all accepted): compliance pack and quota extension request right after Phase 5 (Q-17 a); one GHL Marketplace app created Private in Phase 6 and made Public in Phase 10 (Q-17 b); retention job in Phase 4 (Q-17 c, done); Cloudflare for SaaS spike once the brand domain exists (Q-17 d).

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
4. Automated: 159 tests (Postgres integration included) pass in CI.

## Owner setup

Done: Railway secrets, GCP project `c2c-app`, OAuth client, channel connected.

**New for Phase 5:** follow [docs/SETUP-CLOUDFLARE.md](docs/SETUP-CLOUDFLARE.md) (DNS records, Cloudflare for SaaS, two rules, API token, then `scripts/set-secrets.ps1 -BrandDomain vidrev.app`). Until then replies keep the plain destination URL, as before.

Still deferred from Phase 4 (no billing yet): platform Gemini key and `WEBSUB_SECRET`, see DECISIONS section 8.

## Open issues

- End-to-end run on the owner's channel not done yet (needs the setup above).
- Brand domain vidrev.app bought; still to do: Resend sending domain, `app.vidrev.app` for the app and OAuth (compliance pack), so OAuth stays in Testing mode (reconnect weekly) until then.
- Phase 5 not verified live yet: needs the Cloudflare setup; the Cloudflare for SaaS behaviour is covered by tests with a faked API only.
- Domain Connect goes live per provider only after the template PR and provider onboarding ([docs/domain-connect/README.md](docs/domain-connect/README.md)); P5-09 assumes the name "VidRev".
- Queue page mints reply links on render (one query set per open draft); fine for now, batch it if queues grow.
- Still open: Q-01 (name and domain). GHL merge field names in the provisioning guide must be checked when the workflows are built.
- Proposals CC-01 to CC-06, P3-01 to P3-07, P4-01 to P4-11 and P5-01 to P5-10 in `DECISIONS.md` await owner review (P4-10 accepted 2026-09-25; owner data principle in DECISIONS section 8).
- Poll jobs run one at a time per worker; fine for the founding cohort, revisit with many channels.
- Railway did not run the config-as-code pre-deploy command; migrations run at service start instead.
- `drizzle-kit` pulls a dev-only dependency with a moderate npm audit advisory; not shipped.
- Drive doc 00 Index still says "decisions D-01...D-12" (Drive housekeeping).

## Next phase

Per Q-17 (a): compliance pack right after Phase 5 (Privacy/Terms drafts on vidrev.app, OAuth verification pack with `app.vidrev.app`, quota extension request), then Phase 6 integrations. Starts only after "mehet".
