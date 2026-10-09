# HighLevel Marketplace listing: making the app Public (Phase 10)

The app `vidrev` was created Private in Phase 6 (docs/SETUP-GHL.md). This is what to prepare and click to make it Public (DECISIONS Q-17 b, one app, free connector, billing stays in the owner's checkout). Requirements come from HighLevel's own guide, [Publishing your App to HighLevel Marketplace](https://marketplace.gohighlevel.com/docs/oauth/AppReviewGuidelines); check it again on the day, it changes.

Nothing here can be finished before the Wyoming LLC exists: the listing and the legal pages must name the entity (docs/compliance/README.md). Submit at the same time as the Google verification pack.

## 1. What already works (verify before submitting)

| Reviewer will check | Where it is built |
| --- | --- |
| Install from the listing works, with or without a session in our app | `/api/oauth/crm/callback`, DECISIONS P10-01 to P10-03 |
| Uninstall removes our copy of the tokens, and a grant still waiting for a claim | webhook `/api/hooks/crm`, `wipeGhl`, `ghl_installs` row of the location |
| Clear error states, no platform name on any page the install shows (A-24) | `/connect/crm`: every outcome of an install (connected, waiting, each error) ends there, each error says what to do next; reconnect email when a grant is refused |
| Least privilege scopes, each justified | table in section 3 |
| Webhook signature verified | Ed25519 `X-GHL-Signature`, `src/server/ghl/oauth.ts` |
| Optional workflow action | docs/SETUP-GHL.md section 6 |

Test the two install paths once on the owner's own sub-account before submitting: (a) signed in to the app in the same browser, install from the listing page, the connection appears at once; (b) signed out (private window), install, then sign in with the emailed link in the same browser, and press "Connect to this account" on the dashboard banner.

### Reviewer answer: what happens to the data on uninstall

Owner choice 2026-10-09: the attributed results stay, the answer below explains why. Use it as it is if the reviewer asks.

> When the app is uninstalled, HighLevel sends the uninstall webhook and we delete our copy of the access and refresh tokens at once, together with any install that was still waiting to be claimed; every sync and queued write for that sub-account stops. Contacts, tags and the tracking field we wrote stay in the sub-account, because they belong to the customer. On our side we keep only the results the customer's own campaigns produced (which video and keyword brought an opt-in or a sale), as part of their vidrev account, so their reports stay complete. Nothing from the sub-account is read again after the uninstall. Closing the vidrev account deletes all of it.

Google's review does not cover this: it checks only data from the Google (YouTube) grant, and that has its own rule (deleted when YouTube is disconnected, refreshed or deleted within 30 days otherwise; docs/compliance/OAUTH-VERIFICATION.md). No CRM data reaches Google and no YouTube comment data reaches the CRM.

## 2. Listing content (draft, edit freely)

- **Name**: `vidrev` (lowercase, no "GHL", "highlevel" or "YouTube" in it, D-23).
- **Tagline**: See which video makes money from your comments.
- **Short description** (max 160 characters): Tag contacts from video comment keywords and read buyers back into HighLevel, so you see which video made the sale. (about 125 characters)
- **Detailed description**:
  vidrev turns keyword comments under your videos into subscribers, buyers and revenue, per video and per keyword. When a viewer comments a keyword, you approve a reply that carries a tracked link on your own domain. The link leads to your own opt-in page. This app connects your sub-account so that:
  - every contact who came through a comment is tagged `vidrev`, `vidrev-source-youtube`, `vidrev-keyword-<keyword>`, `vidrev-temperature-<cold|warm|hot>-lead`, `vidrev-video-<videoId>`, `vidrev-buyer` and gets the tracking id in a contact field;
  - buyers, won opportunities and payments are read back, so revenue is attributed to the right video;
  - an optional workflow action returns the video and keyword behind a contact.
  Nothing is posted or sent from your sub-account. The app never reads messages or conversations. The connector is free; the vidrev account is billed separately.
- **Category**: marketing or analytics (pick what the portal offers).
- **Images**: logo (square), 3 to 6 screenshots: the Integrations page with GoHighLevel connected, a contact with the tags and the field, the report per video and keyword, the workflow action step, the Link domain page.
- **Support**: a direct support email and URL, first answer within 24 hours, from the owner (HighLevel requires the developer to answer). Security contact email as well.
- **Privacy Policy and Terms URLs**: the drafts in docs/compliance/ published on the brand site once the LLC is named in them. HighLevel says these fields are not mandatory but it may ask for legal documents during review.
- **Data usage summary**: contacts (email, name, tags, the tracking field), won opportunities and payment transactions are read to attribute revenue; tokens are stored encrypted and wiped on uninstall or disconnect; nothing is sold or shared; YouTube comment data stays in our own system and is never sent to HighLevel.
- **Demo video or quick start**: the docs/compliance/ demo script can be reused; show install, the tag on a contact, the report line.
- **Release notes**: "First public release: one-click connection, contact tags and tracking field, buyer and revenue read-back, workflow action."

## 3. Scope justification (least privilege)

These are the scopes the app requests (`DEFAULT_GHL_SCOPES`). Each answer is what to write in the review form.

| Scope | Why it is needed |
| --- | --- |
| `contacts.readonly` | Read contacts created from an opt-in form to find the tracking id and the buyer tag. |
| `contacts.write` | Create or update the contact that came through a tracked link, add the tags, and add the optional source note. |
| `opportunities.readonly` | Read won opportunities to count a buyer. Their value is never counted as revenue. |
| `payments/transactions.readonly` | Read successful payments and refunds to attribute revenue to a video. |
| `locations.readonly` | Show the sub-account name on the connection. |
| `locations/customFields.readonly` | Find an existing tracking field before creating one. |
| `locations/customFields.write` | Create the single `vidrev tracking id` contact field that holds the tracking id. |

Not requested on purpose: conversations, messages, calendars, campaigns, workflows write, users, snapshots. If the reviewer asks for fewer, `payments/transactions.readonly` and `opportunities.readonly` are the ones that can be dropped (a creator without payments in HighLevel does not need them), at the cost of the buyer read-back.

## 4. Steps in the developer portal

1. Open the app, **Advanced Settings**. Check: Redirect URL is `<APP_BASE_URL>/api/oauth/crm/callback`, webhook URL is `<APP_BASE_URL>/api/hooks/crm`, the scopes match section 3.
2. **Listing** tab: paste the content of section 2, upload the images.
3. Set distribution: keep target user **Sub-account**, listing type **White-label** as chosen in Phase 6.
4. Add the workflow action (docs/SETUP-GHL.md section 6) if it should be part of the review.
5. Press **Start Public review**. HighLevel reviews; answer questions within their time window.
6. After approval the client id in Railway stays the same; the install link `version_id` part is no longer needed (`buildInstallUrl` only adds it for draft client ids).

## 5. After it is Public

- Installs from the listing arrive at the callback with no session; the banner and `/connect/crm` handle them. Watch `/admin` and the worker log for `ghl marketplace install waiting for a claim` and for claims that never complete (a claim expires after 24 hours; the installer must install again).
- The private app cap of 5 agencies no longer applies.
- A creator who installs without a vidrev account is told to get one; nothing else is created for them.
