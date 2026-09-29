# C2C (commentclient) compared with vidrev

Written 2026-09-29. Direction set by the owner: vidrev replaces C2C, not the other way round. C2C stays as it is (live on the HighLevel Marketplace, public v1.0.0; Google sensitive-scope review approved 2026-09-06) until vidrev takes its place.

## Worth taking into vidrev

| # | C2C feature | Where in C2C | Why it is worth it | Size |
| --- | --- | --- | --- | --- |
| 1 | Guard against the "apex artifact": a reply link that points to the app's own host plus a GHL page path (a live 404 twice in C2C) | `app/utils/landing_url.py` | vidrev can hit the same bug: refuse or repair any destination on the app or link host | small |
| 2 | Restore a skipped reply | `app/routes/approvals.py` (`/restore`) | a mis-click on Skip cannot be undone in vidrev today | small |
| 3 | Commenters as GoHighLevel prospect contacts (name only, no email) at comment time, tagged with keyword and lead temperature | `app/crm/ghl.py` | lead compounding by temperature (L-03) starts at the comment, not only at the opt-in | medium |
| 4 | Comments and drafts as a GoHighLevel Conversations thread; the creator replies inside GoHighLevel and it is posted to YouTube | `app/crm/ghl.py`, `app/webhooks/ghl_provider.py` (custom Conversations provider) | "direct integration with GoHighLevel" (L-09) at its strongest; approval stays manual | large |
| 5 | Affiliate forever-free proven by a snapshot marker field | `app/affiliate.py` | replaces the manual Grant access for affiliates | medium |
| 6 | Running inside GoHighLevel (custom menu link, iframe) with SSO | `app/auth/ghl_sso.py` | GHL users stay in GHL; needs the SSO proof, never trust a location id alone | medium |
| 7 | Legal pages and the Google verification pack that passed | `app/routes/legal.py`, `GCP_VERIFICATION.md` | the template for vidrev's own Privacy, Terms and Google review (after the LLC) | small |

## Deliberately not taken

| C2C feature | Why not |
| --- | --- |
| Trial reward steps (Dropbox model, +7 days per step) | The trial is paused (L-08); the steps made onboarding busy |
| Freemium plans billed inside HighLevel (INSTALL, PLAN_CHANGE) | vidrev sells through its own GoHighLevel checkout (D-28, L-02) |
| One account per location, everything keyed by location id | vidrev accounts are people; a location is one connection |
| Many settings, long wizard, many questions | The owner found C2C overwhelming; vidrev keeps one flow with Advanced rows closed |
| Per-video tracking list as a separate screen | vidrev picks videos per automation |

## Already in vidrev (C2C had it first or both have it)

Keyword rules with presets (now the same 15), approval-only replies, tracked short links, YouTube uploads list with views and comments, GoHighLevel funnel page picker with verified domain (ported 2026-09-29, #106), uninstall handling, language detection.

## C2C itself

No new features. Only the keyword list was aligned (C2C #96). When vidrev's Marketplace app goes public (after the LLC), C2C users move to vidrev and the C2C listing is retired; a migration note goes to them first.
