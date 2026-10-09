# Google OAuth verification pack

**Status:** prepared, **not submitted**. Submit after the LLC exists (owner decision 2026-09-25): the Privacy Policy and Terms must name the legal entity from day one. An EIN is not needed for Google.

GCP project: `c2c-app` (customer replies only, D-31, D-34).

## 1. Blocking prerequisites

| # | Item | Status |
| --- | --- | --- |
| 1 | LLC formed; fill docs/compliance/legal-entity.json, rebuild the legal kit | waiting (Northwest, WY) |
| 2 | Privacy Policy and Terms published on `https://vidrev.app/privacy` and `/terms` (GHL pages), linked from the home page | waiting for 1 |
| 3 | `https://vidrev.app` home page describes the app (what it does, that it uses YouTube data, link to privacy) | todo, GHL |
| 4 | App on `https://app.vidrev.app` (Railway custom domain, DNS only record), `APP_BASE_URL` changed, OAuth redirect URI `https://app.vidrev.app/api/oauth/google/callback` added in GCP | todo, before the demo video |
| 5 | vidrev.app verified in Google Search Console with the Google account that owns `c2c-app` | todo |
| 6 | Support email on vidrev.app (e.g. support@vidrev.app) receiving mail | todo |
| 7 | Resend sending domain on vidrev.app, so sign-in mail reaches reviewers | todo |
| 8 | App logo 120x120 px, product name `vidrev` (lowercase) | todo |
| 9 | Platform Gemini key on a **paid** GCP project (Q-13 open point: free-tier Gemini may use data for product improvement, which conflicts with Limited Use) | deferred until billing (DECISIONS section 8) |

## 2. OAuth consent screen (Google Auth Platform > Branding)

- App name: `vidrev`
- User support email: Google only offers the owner's Google account or a Google Group here, not a forwarded address; the developer contact can be me@vidrev.app (Cloudflare Email Routing to the owner's inbox).
- App logo: the 120x120 logo
- App home page: `https://vidrev.app`
- Privacy policy: `https://vidrev.app/privacy`
- Terms of service: `https://vidrev.app/terms`
- Authorized domains: `vidrev.app`
- Developer contact: owner email

## 3. Scopes and justification

Scopes requested: `openid`, `email`, `profile`, `https://www.googleapis.com/auth/youtube.force-ssl` (sensitive).

Justification text for `youtube.force-ssl` (paste):

> vidrev lets a YouTube creator reply to viewers who ask for a resource in a comment. The app reads new top-level comments on the creator's own channel (commentThreads.list with allThreadsRelatedToChannelId) to find comments that contain the creator's keywords, shows a draft reply to the creator, and after the creator approves each reply individually, posts it as a reply to that comment (comments.insert). Posting comment replies requires youtube.force-ssl; the read-only youtube.readonly scope cannot insert comments, and no narrower scope allows replying. We never post without the creator's explicit approval of that specific reply, never like, subscribe or modify anything else, and delete comment data within 30 days.

`openid email profile`: to identify the creator's Google account at connection and show which account is connected.

## 4. Demo video (unlisted YouTube, 2 to 4 minutes, English)

Script, in order:

1. Browser at `https://vidrev.app`: the home page, then the Privacy Policy link.
2. Sign in to `https://app.vidrev.app` (magic link).
3. Click "Connect channel". The Google consent screen shows **app name vidrev** and the address bar shows the **OAuth client id** (zoom in on the URL). Show the requested scope text, then Allow.
4. Back in the app: the channel appears as connected.
5. Keywords page: create keyword `guide` with an approved reply template containing `{link}`.
6. From a second account, comment "guide please" under a video of the channel.
7. Approval queue: the draft appears; show that nothing is posted yet; edit and click Approve.
8. On YouTube: the reply appears under the comment, with the tracked link.
9. Show "Disconnect channel", and mention that YouTube data is deleted at once; show `https://myaccount.google.com/permissions` as the revocation place.

Voice or captions should say at step 3 and 7: "vidrev uses the youtube.force-ssl scope only to read comments on your own channel and post replies you approve one by one."

## 4b. Answers to expect from the reviewer

- Limited Use: the only Google user data is the creator's own comments and channel id. Not sold, not used for ads, not used for AI training (default drafts run on a billing-enabled Gemini project under terms without training; own keys are the creator's agreement). Humans do not read it.
- Retention: 30 days, refreshed or deleted by the daily job; deleted at once on disconnect (Privacy Policy section 4).
- Audit my channel is not part of this OAuth client: it uses public data with an API key from a separate project and needs no consent screen.
- Logo: 120x120 px PNG on a solid background, no baked-in checkerboard, product name lowercase `vidrev`.

## 5. Submission steps (when section 1 is done)

1. Google Cloud console, project `c2c-app` > Google Auth Platform > Audience: switch from Testing to **In production**.
2. Verification Center > Prepare for verification > fill sections 2 and 3, add the demo video URL.
3. Submit. Expect emails from the Google Trust & Safety team; answer within days, from the developer contact address.
4. Record the submission date in STATUS.md.

After approval the 100-user cap and the weekly refresh token expiry of Testing mode end.
