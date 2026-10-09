# YouTube API quota extension request

**Status:** prepared, **not submitted**, sized from the production ledger on 2026-10-08. Zoltan submits it after the Google OAuth verification (DECISIONS A-36). Form: "YouTube API Services - Audit and Quota Extension Form" (at the time of writing https://support.google.com/youtube/contact/yt_api_form; check the link in the YouTube API docs before submitting). No EIN needed; organization name = the LLC.

The quota extension is an upside, never a dependency (D-27): until approved, the app shares 10,000 units a day and offers the zero-quota manual fallback.

## 1. Sizing (measured, 2026-10-08)

Costs: `commentThreads.list` 1 unit per page, `comments.insert` 50 units, `videos.list`, `playlistItems.list` and `channels.list` 1 unit each.

### What the production ledger says

`npm run quota:report -- 14` and `-- 30`, run on 2026-10-08 inside the Railway `web` service against production (`quota_ledger`, project `app`). Both windows hold the same data: 5 days with calls (2026-09-25 to 2026-10-08), 1 connected channel (the owner's test channel).

| Method | Units | Share |
| --- | --- | --- |
| `commentThreads.list` (poll) | 864 | 63.9% |
| `comments.insert` (9 replies) | 450 | 33.3% |
| `videos.list` | 19 | 1.4% |
| `playlistItems.list` | 13 | 1.0% |
| `channels.list` | 7 | 0.5% |
| **Total** | **1,353** | average 271 a day, peak 1,057 on 2026-10-07 |

The script's own projection (271 units per channel per day times 100, plus 30%) suggests 40,000 a day. That figure is too low to ask for: the test channel sent 9 replies in two weeks, far below what a paying creator sends, and on most days it was not polled at all. So the request below takes the **measured cost per call** and the **engine's real schedule and plan caps**, not the test channel's light use.

### The calculation, step by step

1. **Cost of one poll, measured:** 864 `commentThreads.list` calls cost 864 units, so one poll is 1 unit (one page).
2. **Polls per channel per day, from the engine** (`TIER_MINUTES`: every 2 minutes for 48 hours after an upload, every 15 minutes otherwise): a weekly uploader has 2 days at 720 polls and 5 days at 96 polls, (2 x 720 + 5 x 96) / 7 = **274 polls a day = 274 units**.
3. **Other reads, measured:** on the busiest day (2026-10-07: video list, uploads list, channel check) 13 + 8 + 1 = **22 units a day**.
4. **Reads per channel per day:** 274 + 22 = **296 units**.
5. **Replies:** 50 units each. Every plan caps replies at 300 a month, about 10 a day: 10 x 50 = **500 units**.
6. **Per channel per day:** 296 + 500 = **796 units**.
7. **Target: the Founding 100** (100 channels): 100 x 796 = **79,600 units a day**.
8. **30% headroom** (upload days of many channels falling together, retries, the identity refresh): 79,600 x 1.3 = 103,480, rounded up: **105,000 units a day**.

The 2026-10-07 peak (685 polls) ran in owner test mode (`FAST_POLL_ACCOUNTS`, every minute), which customers never get; it is not used for the sizing. The Publishing Dream Team connection (DECISIONS A-36) spends no quota.

| Channels | Units per day (796 each) |
| --- | --- |
| 12 (fits today's 10,000) | 9,552 |
| 50 | 39,800 |
| 100 (Founding 100) | 79,600 |
| 100 with 30% headroom | 103,480 |

Scope: only the product project `c2c-app`. Audit my channel runs in its own project (`vidrev-audit`, API key, public data, at most 13 units per audit, own 10,000 units a day) and is not part of this request.

**Request: 105,000 units per day** for project `c2c-app`.

### Short justification for the Google form (English, paste as is)

vidrev helps YouTube creators answer viewers who ask for a resource in the comments. Each reply is drafted by the app and posted only after the channel owner approves that single reply; nothing is posted automatically. Our goal is the first 100 creator channels (our Founding 100 cohort). We measured our production usage: one poll of a channel's new comments costs 1 unit, and a channel is polled every 2 minutes for 48 hours after an upload and every 15 minutes otherwise, which is about 274 units a day for a weekly uploader, plus about 22 units of other reads. Each approved reply costs 50 units, and our plans cap replies at 300 a month (about 10 a day, 500 units). That is about 796 units per channel per day, 79,600 units for 100 channels, and 103,480 units with 30% headroom. We request 105,000 units per day. Quota-saving measures already in place: channel-level comment listing instead of per-video polling, new uploads detected by PubSubHubbub push and RSS at zero quota, activity-based polling tiers with a global daily budget, reads capped at 25% of the day, per-plan reply caps, and a manual reply option that costs no quota.

### Who submits and when

Zoltan submits the request after the Google OAuth verification (A-13, LAUNCH-CHECKLIST section B). Before submitting, run the report again (`railway run --service web npm run quota:report -- 30`, or inside the service with `railway ssh`) and update the table above if real customers changed the picture.

## 2. Answers for the form

- **Project number / API client:** from GCP `c2c-app`.
- **Organization:** the `name` in docs/compliance/legal-entity.json, website `https://vidrev.app`.
- **What does your client do:** vidrev helps YouTube creators answer viewers who ask for a resource in the comments. It reads top-level comments on the creator's own channel, finds comments containing the creator's keywords, drafts a reply and posts it only after the creator approves that single reply. Links in replies point to the creator's own website.
- **How do you use YouTube data:** comment text and commenter names are shown only to the channel owner in the approval queue; they are deleted within 30 days; nothing is shared or sold; no data is used for AI training.
- **Why more quota:** each approved reply costs 50 units and all customers share one project. With 10,000 units a day we can serve about 12 channels; the founding cohort is 100 channels (section 1: 796 units per channel per day, 105,000 requested).
- **Quota-saving measures already built:** channel-level listing (`allThreadsRelatedToChannelId`) instead of per-video polling; new uploads detected by PubSubHubbub push and RSS at zero quota; activity tiers (2 / 15 / 60 minutes) with a global budget; reads capped at 25% of the day; per-plan monthly reply caps; replies over budget wait for the next day; a manual "copy reply and open comment" fallback that costs nothing.
- **Compliance:** approval-only posting, no automated engagement requests (like/subscribe wording is blocked), 30-day retention job, immediate deletion on disconnect, Privacy Policy with YouTube and Google disclosures.
- **Screenshots or video:** reuse the OAuth demo video (OAUTH-VERIFICATION.md section 4).

## 3. After submission

The YouTube team may run a compliance audit and ask for screen recordings or access. Answers go from the developer contact address. Typical first approvals are 50,000 to 100,000 units a day; timing varies from days to months (D-35).
