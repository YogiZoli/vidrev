# PRD and Roadmap

Source: Drive doc "04 C2C SaaS PRD és Roadmap", draft v1, 2026-09-24, translated to English. Decisions live in [DECISIONS.md](../DECISIONS.md) and win on any conflict.

> **Superseded points in this PRD (see CC-05).** The PRD predates several decisions. Where marked with **[superseded]**, follow the named decision:
> - "Approval or auto mode": there is no auto mode (D-25).
> - "Base domain + Pro CNAME": the user's own domain is the default for everyone, go.brand.tld is only the fallback (D-33).
> - "Built on the existing C2C app / Counter": new codebase, the legacy app is not a pattern (D-14, D-26, D-30).
> - Adaptive polling timings: replaced by activity tiers (D-27).
> - Pricing tiers: plans are data (B-05); the standard price is an open question.

## 1. Summary

The product (codename C2C, Comment-to-Client) is a SaaS that turns video comments into subscribers and measurable revenue. A viewer comments a keyword, the app replies on behalf of the creator with a branded, tracked link, the viewer subscribes on the creator's own opt-in page, and their purchase is attributed back to the video and keyword it came from.

**Positioning:** "See which video makes money from your comments." (D-01)

**Starting point [superseded by D-14, D-30]:** the legacy C2C app works, is GCP OAuth approved and GHL Marketplace approved; its dashboard Counter already shows buyer count and revenue separately.

## 2. Problem

- Creators use comment CTAs ("comment GUIDE") but reply manually, or not at all.
- Existing tools (CommentShark, ReplyTide) reply, but **do not tell which video made how much money.**
- So the creator cannot tell which video type, keyword and offer is worth building on.

## 3. Target users

| Priority | Segment | Why |
| --- | --- | --- |
| 1 | Coaching, agency, real estate and fitness coach creators using GHL | Measured GHL share in these niches is about 20% (03 research) |
| 2 | Course creators and coaches on other stacks (Kit, Kajabi, Skool, ClickFunnels) plus Stripe | Majority of the market; reachable through webhooks and Stripe |
| 3 | GHL agencies serving creator clients | Several channels in one account, resale |

Not a target (for now): large brands and enterprise teams, non-English markets.

## 4. Goals and success metrics

| Area | Metric | Target (draft) |
| --- | --- | --- |
| Activation | Time from channel connection to the first real opt-in | Within 7 days |
| Value | Share of customers who see revenue in the report within 30 days | At least 50% |
| Entry | Audit my channel, then opt-in, then trial conversion | To be measured; baseline after the first 100 audits |
| Retention | Monthly churn | Below 5% |
| Business | MRR within 24 months | 3,500 to 10,500 USD (owner model, 01) |

## 5. Features

### MVP (required)

| Feature | Description | Decision |
| --- | --- | --- |
| Keyword replies | Only for explicit keywords, varied templates, approval **[superseded: approval only, D-25]** or auto mode, per-video and per-hour limits | 01 compliance, D-25 |
| Branded, tracked link | Base domain + Pro CNAME **[superseded: user's own domain by default, D-33]**; tracking id to the user's own opt-in page | D-02, D-33 |
| GHL integration | Write contacts and tags, read back won opportunities and buyer tags | D-07 |
| Universal webhook | HMAC-signed events plus tag scheme | D-03 |
| Reporting layer | Clicks, subscribers, buyers, revenue, conversions per video and keyword; justification line on top | D-05 |
| Data handling | 30-day refresh or deletion for API data; email-based attribution | D-04 |

### Round 2

| Feature | Description | Decision |
| --- | --- | --- |
| Audit my channel | Free channel diagnosis: unanswered questions, buying signals, keyword opportunities, link audit, stack detection, Comment Conversion Score | D-10 |
| Stripe | Match purchases by email | D-07 |
| Resource email fallback | Lead magnet delivery for users without a CRM | D-08 |
| Zapier, Make, n8n | Ready app or template for the webhook | D-07 |

### Later

Education platforms (Gumroad, Kajabi, Teachable, Thinkific, Lemon Squeezy, ThriveCart), niche benchmark report (D-06), agency multi-channel view. PayPal, Mailchimp, HubSpot only on request.

### Non-goals

Engagement gates (subscribe or like requirements), mass or unsolicited commenting, cold outreach, estimated revenue metrics, training AI models on Google data.

## 6. User journey

1. **Audit my channel:** the creator enters their channel, instantly sees 3 findings, gets the full report by email (opt-in).
2. **Trial:** connects their video account and their CRM (GHL natively, others through webhooks).
3. **Campaign:** keyword, reply templates, the URL of their own opt-in page; the app generates the tracked link.
4. **Operation:** a viewer comments, the app replies (after approval, D-25), the viewer subscribes on the creator's page, a tag and an event land in the CRM.
5. **Purchase:** GHL or Stripe reports it, the app ties it to the video and keyword by email.
6. **Report:** "This month your comments made $X."

### Audit my channel conversion steps

| Step | Content |
| --- | --- |
| Entry | Channel handle, no registration |
| Instant preview | The 3 strongest findings, real numbers only |
| Opt-in | Full report by email |
| Segmentation | By stack: GHL path or other path |
| Trial | "Let's measure these comments for 7 days" |
| Re-audit | After 30 days, the change in the Comment Conversion Score as proof |

Technical: API key, no OAuth, about 5 to 10 units per audit, separate GCP project, 24h cache, raw comments deleted within 30 days.

## 7. Pricing (draft, to be validated) [superseded by B-05 for plan structure; standard price open]

| Plan | Price (owner model) | Content |
| --- | --- | --- |
| Starter | 29 USD/month/channel | Keyword replies, tracked link, webhook, basic report |
| Pro | 49 USD/month/channel | + CNAME branded domain, Stripe, full attribution report |
| Scale | 99 USD/month/channel | + larger reply cap, benchmark |
| Agency | custom | Several channels, resale |

Per channel pricing (per location in GHL); no per-lead pricing, because the number of subscribers is capped by quota.

## 8. Non-functional requirements

- **Compliance:** Privacy Policy and Terms per 01, Limited Use statement, approval mode, 30-day data handling.
- **Quota:** separate GCP project per use case (D-31, D-34); quota audit for 100,000 units; channel-level listing; activity-based polling (D-27).
- **Security:** tokens encrypted, webhooks HMAC-signed.
- **Reliability:** reply sending queued and retried; quota exhaustion visible on the dashboard.

## 9. Dependencies and risks

| Dependency | Risk | Mitigation |
| --- | --- | --- |
| YouTube Data API | Quota, policy changes | Early audit, CRM-independent core, quota strategy D-27 |
| GHL Marketplace | Changing terms | Webhooks and Stripe as alternatives |
| Creator's own page | Missing hidden field breaks attribution | Onboarding check and test opt-in |
| Email match | Different email at purchase | Tracked link click id as a second key |

## 10. Roadmap (from 04; the build phases in STATUS.md are the operative plan)

Durations are owner estimates.

| Phase | Content | Estimate | Done when |
| --- | --- | --- | --- |
| 0. Research | Market research and GHL fingerprint research | Done (2026-09-24) | Docs 01, 02, 03 |
| 1. Core (MVP) | GHL won opportunity and buyer tag read-back; tracked link (user domain via CNAME, fallback domain); webhook and tag scheme; reporting layer; quota audit submission | 4 to 6 weeks | The first 3 beta customers see revenue per video |
| 2. Entry | Audit my channel on a separate GCP project, landing page | 2 to 3 weeks | The audit collects opt-ins live |
| 3. Revenue | Stripe integration, resource email fallback | 2 weeks | A non-GHL customer also sees revenue |
| 4. Automators | Zapier, Make, n8n | 1 to 2 weeks | Ready templates for all three |
| 5. Education platforms | Gumroad, Kajabi, Teachable, Thinkific, Lemon Squeezy, ThriveCart | Ongoing, on demand | First live customer per platform |
| 6. Benchmark | Niche benchmark report | After at least 30 to 50 customers | Niche average appears in the report |

## 11. Open questions (from 04, with current status)

- New app and domain, or extend the legacy app? **Resolved: new app (D-14, D-26).**
- Owner entity: **Wyoming LLC (D-13)**, not formed yet.
- Product name, domain and link domain: name and domain open; link domain resolved (D-28, D-33).
- Build on the legacy codebase, keep Railway? **Resolved: new codebase (D-14), Railway (D-29).**
- Pricing: are 29/49/99 right, free plan, card for trial? **Open** (see DECISIONS open question 2).
- Where do the first 3 beta customers come from inbound? **D-16.**
- English only at launch? **Resolved: English UI (D-17, B-06).**
- Do current legacy users move to the new app? **D-26:** legacy app frozen, then retired.
- What does the legacy Counter measure? **Moot per D-30.**
- Is a SPEC (05) needed? **Resolved: yes, see [SPEC.md](SPEC.md).**
