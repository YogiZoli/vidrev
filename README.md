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

Requirements: Node.js 24 (see `.nvmrc`) and a Postgres database (a local server, or the public URL of a Railway Postgres dev database).

```bash
npm install
cp .env.example .env        # then set DATABASE_URL
npm run db:migrate          # apply migrations
npm run dev                 # web on http://localhost:3000
npm run dev:worker          # worker (second terminal)
```

Checks (the same ones CI runs):

```bash
npm run lint
npm run typecheck
npm test                    # DB integration tests run only when DATABASE_URL is set
npm run build
```

Schema changes: edit `src/db/schema.ts`, then `npm run db:generate` and commit the new file in `drizzle/`.

## Layout

| Path | What |
| --- | --- |
| `src/app` | Next.js App Router pages and API routes (`/api/health`) |
| `src/worker` | pg-boss worker process (all external API calls run here) |
| `src/db` | Drizzle schema, client, queries |
| `src/lib` | Shared code (env validation, health logic, logging) |
| `src/scripts/migrate.ts` | Migration runner (runs on every service start, advisory-locked) |
| `drizzle/` | Generated SQL migrations |
| `scripts/start.mjs` | Start command for both Railway services (role from `RAILWAY_SERVICE_NAME`) |

## Deployment

Railway project `c2c-saas`, environment `production`: services `web`, `worker` and `Postgres`. Both app services deploy from `main` on GitHub with the shared `railway.json`; migrations run at service start (advisory-locked). Only code changes trigger a deploy (`watchPatterns`); documentation commits do not.
