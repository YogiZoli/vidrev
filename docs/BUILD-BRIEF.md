# Build brief (owner, 2026-09-25)

The owner's original instructions to Claude Code for building this product, stored here so every new session can start from the repo.

**Precedence:** the owner's later answers in [DECISIONS.md](../DECISIONS.md) (section 5 and D-38) override this brief where they differ. Resolved conflicts so far: tracked links use the user's own subdomain with Domain Connect automation (D-38); every purchase from every source is stored but revenue is counted once (Q-05); recurring revenue counts for the whole life of an active subscription (Q-07); inbound provisioning auth is a Bearer secret plus idempotency, HMAC when present (Q-04); no bulk approval (Q-12); no commenter dedupe (Q-14); Gemini including the free tier is supported (Q-13).

---

You are the lead engineer building a new SaaS product end-to-end. Work in phases. Talk to me (Zoltan) in Hungarian; write all code, commits and repo docs in English.

## Resume protocol (do this first, every time)
1. The GitHub repo already exists: https://github.com/YogiZoli/c2c-saas (private). Local path: C:\Users\gdp\repos\c2c-saas. If the local folder is missing, clone it with gh (authenticated as YogiZoli).
2. If STATUS.md exists, read STATUS.md and DECISIONS.md and continue with the first phase not marked DONE. Never redo DONE phases.
3. Never start a new phase without my explicit approval ("mehet"). At the end of every phase: update STATUS.md (status, what was built, how to test, open issues, next phase), commit with a conventional commit message, push, then STOP and summarize in Hungarian in max 10 lines.

## Source of truth
Drive folder: https://drive.google.com/drive/folders/1OXKOO_V1a9lJOAI3KyHUwgb_uVd3wtbD
Read in this order: 00 Index, 02 Decision log (authoritative on conflict), 04 PRD and Roadmap, 05 SPEC. Only content above each doc's ARCHIVE section is valid; inside 05, "UPDATE" and "APPROVED" notes override the text they refer to, and anything marked WITHDRAWN must be ignored. If you cannot access Drive, stop and ask me to paste 02 and 05. (The repo copies in DECISIONS.md, docs/PRD.md and docs/SPEC.md are kept in sync with Drive.)

## Product in one paragraph
Positioning: "See which video makes money from your comments." A viewer comments a keyword under a YouTube video. The app drafts a reply with AI, the creator approves it, and the app posts it from the creator's account with a tracked link on the CREATOR'S OWN domain that leads to the creator's own opt-in page. The opt-in carries a tracking id in a hidden field. Purchases are matched back by email and tracking id to the video and keyword. UI vocabulary: Comment -> Subscriber -> Buyer -> Revenue (avoid "lead" and "client" in UI). Target: active owner-creators who already sell their own offer and upload regularly; entry segment GoHighLevel users in coaching, agency, real estate and fitness niches.

## Non-negotiable rules
- Only real metrics: clicks, subscribers, buyers (unique), revenue (sum), conversions per video and keyword. No estimated values. Report headline: "This month your comments made $X. Your subscription was $Y." (Replaced by Q-09: this month and lifetime revenue, the recurring part, and the subscription cost as a percentage of attributed revenue.)
- Tracked links on the USER'S OWN domain are mission critical (02 D-33): CNAME onboarding (e.g. go.userdomain.com) with DNS verification and automatic TLS via Cloudflare for SaaS (Custom Hostnames). The owner fallback domain go.brand.tld is only for users without a domain.
- Approval-only sending (02 D-25): every reply is a draft until the creator approves it; no auto-posting. Drafts come from the user's OWN AI key (Anthropic, OpenAI or Gemini, encrypted at rest), falling back to approved templates.
- YouTube compliance: scope youtube.force-ssl only (+ openid/email/profile). Reply only to explicit keyword comments, varied templates, per-video and per-hour limits, never require like/subscribe. Store YouTube API data max 30 days or refresh every 30 days. Never use Google user data for model training. Never post an unapproved machine translation. No "YouTube", "YT", "Tube" or "GHL" in product naming.
- Reply language: commenter language only if an approved template exists in that language, else creator default language (set manually), else English. UI English only.
- Quota (02 D-27, D-31): 10,000 units/day per GCP project shared by ALL customers; list 1 unit, comments.insert 50 units. Channel-level polling only (allThreadsRelatedToChannelId), never per video. New uploads detected without quota via YouTube PubSubHubbub push (fallback RSS), which switches the channel to fast polling for 48h. Activity tiers: fresh video 2 min, normal 15 min, quiet channel 60 min. Daily quota budget with a reply reserve; approved replies are spread across the Pacific-time quota day and what does not fit is sent first after the midnight PT reset; transparent queue with estimated send time and an honest YouTube-quota note, plus a "Copy reply and open comment on YouTube" manual fallback. Per-plan monthly reply caps. NEVER use multiple GCP projects for the same use case. Audit my channel uses its own separate GCP project (different use case, 02 D-34). Enterprise plan: BYOK, the customer's own GCP project and OAuth client (02 D-32).
- Domains (02 D-28): one owner domain. brand.tld runs in GoHighLevel (landing, checkout, Privacy, Terms); the app runs on app.brand.tld. Names and domains are undecided: use env vars PRODUCT_NAME, BRAND_BASE_URL, APP_BASE_URL, LINK_FALLBACK_BASE_URL. Never hardcode them.
- Billing is NOT in the app. Checkout lives in GoHighLevel and calls a signed provisioning webhook (purchase -> activate + magic link; cancel/failed payment -> suspend). Plans are data: standard_monthly (price configurable), founding (annual, 97 USD/year, renewal price locked for life, seat cap 100), ghl_affiliate_free (granted manually or by webhook), enterprise (BYOK), internal. No lifetime plan.
- Stack (02 D-36): TypeScript, Next.js (App Router), Postgres, Drizzle ORM, pg-boss worker, Resend, Vitest. Infrastructure (02 D-29): everything in the Railway project c2c-saas (services web and worker, plus Postgres). No Supabase, no Upstash, no Redis.
- Performance: the UI never waits on YouTube or GHL; all external calls run in the worker; dashboards read precomputed aggregates; optimistic UI for approvals.
- Secrets only in env vars; .env git-ignored. Encrypt OAuth tokens and AI keys at rest. HMAC-sign outbound webhooks and verify inbound ones.
- Railway: create the project c2c-saas with the Railway CLI. Never touch other Railway projects. If a CLI is not logged in, stop and tell me exactly what to do.
- Owner entity: Wyoming LLC (not formed yet). Legal pages are drafts marked "DRAFT - needs legal review".
- The legacy commentclient repo and app are NOT a reference or pattern (02 D-30). Do not read or copy from them, and never touch them. Never delete data or repos.

## Phases
Phase 0 - Bootstrap: clone repo, add README.md, STATUS.md, DECISIONS.md (all valid decisions from 02), docs/PRD.md (from 04), docs/SPEC.md (from 05, with UPDATE/APPROVED notes merged in and WITHDRAWN parts removed), .gitignore, .env.example. Commit, push, stop.
Phase 1 - SPEC review (high effort): review docs/SPEC.md critically, list gaps, risks and every decision you need from me; propose fixes. Stop.
Phase 2 - Scaffold and deploy: app skeleton, Postgres, migrations, health check, CI (lint + tests), Railway project c2c-saas, first deploy. Stop.
Phase 3 - Accounts: magic-link login, provisioning webhook, plans table and seeds, YouTube OAuth connect with encrypted tokens (give me exact steps to create the new GCP project and OAuth client). Stop.
Phase 4 - Comment engine: channel-level polling with activity tiers, PubSubHubbub upload detection, keyword rules, AI drafts with the user's own key, templates per language, approval queue, reply scheduling with the daily quota budget, transparent queue, manual fallback, quota ledger. Stop.
Phase 5 - Tracked links on the USER'S OWN domain (mission critical): CNAME onboarding with DNS check, automatic TLS via Cloudflare for SaaS (Custom Hostnames), fallback domain, click ids, campaign/video/keyword mapping. Stop.
Phase 6 - Integrations: outbound HMAC webhooks and tag scheme (c2c, c2c_kw_<keyword>, c2c_vid_<videoId>, c2c_buyer); GoHighLevel via OAuth: write contacts and tags, read won opportunities and buyer tags; universal inbound opt-in and purchase webhooks. Stop.
Phase 7 - Attribution and reporting: opt-in and purchase matching (email + tracking id, last touch within 180 days, refunds), dashboard per video and keyword, headline sentence. Stop.
Phase 8 - Stripe revenue ingestion (read-only via Stripe Connect OAuth). Stop.
Phase 9 - Audit my channel: public page, API key from its own separate GCP project, 24h cache, IP rate limit, real numbers only, email opt-in for the full report, stack detection by following description links. Stop.
Phase 10 - GHL Marketplace connector: free Marketplace app for one-click connection (location OAuth), creates the c2c_tid field and tags, optional workflow trigger and action. Stop.
Phase 12 - Compliance and launch readiness: Privacy Policy and Terms drafts for BRAND_BASE_URL (YouTube API Services disclosure, Google Privacy Policy link, Limited Use statement, revocation steps), 30-day retention job, Google OAuth verification checklist and demo video script, quota extension request draft sized to real usage. Stop.

## Working style
- Small, reviewable commits. Tests for matching logic, quota budgeting and scheduling, plan caps, custom domain verification and webhook signing.
- If something is ambiguous, pick the simplest option consistent with these rules, record it in DECISIONS.md as a proposal, and flag it in the phase summary.
