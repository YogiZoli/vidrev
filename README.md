# c2c-saas

Internal codename for a new SaaS: **"See which video makes money from your comments."**

A viewer comments a keyword under a video. The app drafts a reply with AI, the creator approves it, and the app posts it from the creator's account with a tracked link on the creator's own domain. The link leads to the creator's own opt-in page, which stores a tracking id (`c2c_tid`) in a hidden field. Purchases are matched back by email and tracking id to the video and keyword.

UI vocabulary: Comment, Subscriber, Buyer, Revenue.

The product name and domains are not decided yet. They are configuration (`PRODUCT_NAME`, `BRAND_BASE_URL`, `APP_BASE_URL`, `LINK_FALLBACK_BASE_URL`), never hardcoded.

## Start here

| File | What is in it |
| --- | --- |
| [STATUS.md](STATUS.md) | Where the build is now, how to test it, next phase |
| [DECISIONS.md](DECISIONS.md) | All valid decisions (D-01 to D-36), build brief decisions, open proposals |
| [docs/PRD.md](docs/PRD.md) | Product requirements and roadmap |
| [docs/SPEC.md](docs/SPEC.md) | Technical specification (implementation reference) |
| [.env.example](.env.example) | Every environment variable the app uses |

## Stack

TypeScript, Next.js (App Router), PostgreSQL, Drizzle ORM, pg-boss worker, Resend, Vitest. Hosted in the Railway project `c2c-saas` (services `web` and `worker`, plus Postgres). No Redis, no Supabase, no Upstash.

## Ground rules

- Only real metrics, never estimates.
- Every reply is approved by the creator before sending. No auto-posting.
- The UI never waits on external APIs; all external calls run in the worker.
- Secrets only in env vars. OAuth tokens and AI keys are encrypted at rest.
- The legacy commentclient app is not a reference or pattern for this codebase.

## Local development

Set up in Phase 2 (scaffold). Until then this repo contains documentation only.
