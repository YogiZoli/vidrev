# YouTube API quota extension request

**Status:** prepared, **not submitted**. Submit after the LLC exists and after the owner's channel ran end to end (Q-02), ideally right after the OAuth verification submission. Form: "YouTube API Services - Audit and Quota Extension Form" (at the time of writing https://support.google.com/youtube/contact/yt_api_form; check the link in the YouTube API docs before submitting). No EIN needed; organization name = the LLC.

The quota extension is an upside, never a dependency (D-27): until approved, the app shares 10,000 units a day and offers the zero-quota manual fallback.

## 1. Sizing (from the implemented engine, Phase 4)

Costs: `commentThreads.list` 1 unit per page, `comments.insert` 50 units, `videos.list` 1 unit.

Per active channel per day (founding cohort, weekly uploads):
- Polling: 15-minute tier = 96 polls; the 48 hours after an upload run every 2 minutes = 720 polls a day. Weekly uploader: (2 x 720 + 5 x 96) / 7 = about **275 units**.
- Video titles and retention refresh: about **5 units**.
- Replies: plan cap 300 a month, about 10 a day = **500 units**.
- Total about **780 units per channel per day**.

| Channels | Units per day |
| --- | --- |
| 13 (fits today's 10,000) | about 10,000 |
| 100 (founding cohort) | about 78,000 |

### Real usage (fill in before submitting)

Run `railway run --service web npm run quota:report -- 14` against production. It prints the units per method and per connected channel from `quota_ledger`, a projection for 13, 50, 100 and 250 channels, and a suggested request with 30% headroom. Paste the table here and replace the estimates above where they differ. The identity refresh (`comments.list` by id, 1 unit per 50 commenter references, once every 30 days) is negligible.

| Item | Estimate | Measured (date range) |
| --- | --- | --- |
| Units per channel per day | about 780 | to fill |
| Peak day, all channels | to fill | to fill |
| Share of replies (`comments.insert`) | about 64% | to fill |

Scope: only the product project `c2c-app`. Audit my channel runs in its own project (`vidrev-audit`, API key, public data, at most 13 units per audit, own 10,000 units a day) and is not part of this request.

**Request: 100,000 units per day** for project `c2c-app`, which covers the 100 founding channels with headroom. Update the table with real numbers from `quota_ledger` before submitting.

## 2. Answers for the form

- **Project number / API client:** from GCP `c2c-app`.
- **Organization:** [LEGAL ENTITY], website `https://vidrev.app`.
- **What does your client do:** vidrev helps YouTube creators answer viewers who ask for a resource in the comments. It reads top-level comments on the creator's own channel, finds comments containing the creator's keywords, drafts a reply and posts it only after the creator approves that single reply. Links in replies point to the creator's own website.
- **How do you use YouTube data:** comment text and commenter names are shown only to the channel owner in the approval queue; they are deleted within 30 days; nothing is shared or sold; no data is used for AI training.
- **Why more quota:** each approved reply costs 50 units and all customers share one project. With 10,000 units a day we can serve about 13 channels; the founding cohort is 100 channels.
- **Quota-saving measures already built:** channel-level listing (`allThreadsRelatedToChannelId`) instead of per-video polling; new uploads detected by PubSubHubbub push and RSS at zero quota; activity tiers (2 / 15 / 60 minutes) with a global budget; reads capped at 25% of the day; per-plan monthly reply caps; replies over budget wait for the next day; a manual "copy reply and open comment" fallback that costs nothing.
- **Compliance:** approval-only posting, no automated engagement requests (like/subscribe wording is blocked), 30-day retention job, immediate deletion on disconnect, Privacy Policy with YouTube and Google disclosures.
- **Screenshots or video:** reuse the OAuth demo video (OAUTH-VERIFICATION.md section 4).

## 3. After submission

The YouTube team may run a compliance audit and ask for screen recordings or access. Answers go from the developer contact address. Typical first approvals are 50,000 to 100,000 units a day; timing varies from days to months (D-35).
