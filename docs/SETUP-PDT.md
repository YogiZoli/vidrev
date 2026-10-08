# Connect Publishing Dream Team (PDT)

vidrev works on its own. The PDT connection only saves typing: a video produced in IdeaToVideo and published by PDT gets its keyword automations in vidrev without anyone setting them up by hand. Decisions A-30 to A-36, API in [SPEC.md](SPEC.md) section 14a.

## Owner setup

Nothing is required. Two optional settings on the Railway service `web`:

| Setting | Default | When to set it |
| --- | --- | --- |
| `PDT_REDIRECT_ORIGINS` | `https://dreamteam.commentclient.com` | PDT moves to another address, or a second PDT instance (comma separated, https only; `http://localhost` is allowed for testing) |
| `CARD_MAX_BYTES` | 2097152 (2 MiB) | PDT changes its own `CARD_MAX_BYTES`; keep both equal |

## The Connect, step by step

1. In PDT the creator presses Connect vidrev. PDT opens `https://app.vidrev.app/connect/pdt?redirect_uri=<PDT callback>&state=<random>`.
2. Not signed in to vidrev: the login page opens, and after sign-in (email and password or Google) the creator is back on the connect page.
3. The page says "Connect Publishing Dream Team" and lists what PDT may do. **Allow** sends the browser to `<PDT callback>?code=<code>&state=<state>`; **Cancel** sends `?error=denied&state=<state>`.
4. PDT's server calls `POST https://app.vidrev.app/api/v1/connect/token` with `{"code": "<code>"}` within 10 minutes. The code works once. The answer is `{"token": "vidrev_pat_...", "accountName": "..."}`. PDT stores the token as a secret.
5. Done. A new connect replaces the previous one; `POST /api/v1/connect/revoke` (with the token) ends it.

## What happens with a video

1. PDT sends the card: `POST /api/v1/cards` with the Video Publishing Card JSON. vidrev answers one tracked link per keyword (`links`), for the description or the pinned comment. Nothing runs yet: no polling, no drafts, no quota.
2. PDT publishes the video and calls `POST /api/v1/cards/<cardId>/published` with `{"videoId": "..."}`. Every keyword goes live on that video, the links stay the same, and the creator gets an email listing what went live. The answer:
   - `armed`: live now through this card
   - `alreadyLive`: an automation of the creator already watches this keyword on the video (for example "All my videos"); nothing duplicated
   - `notArmed`: not live, with the reason (a paused automation, or no address to send viewers to)
3. Replies wait for the creator's approval in vidrev, exactly as for any other automation.
4. `GET /api/v1/videos/<videoId>/outcomes` gives counts per keyword: commenters, email subscribers, buyers, revenue. Nobody is named.

## Troubleshooting

| Answer | Meaning |
| --- | --- |
| 401 | The token is wrong or revoked: connect again. |
| 403 | The vidrev account is not active (sign-up without checkout or trial). |
| 409 on published | No YouTube channel is connected in vidrev, or the card was already published as another video. |
| 413 | The card is larger than `CARD_MAX_BYTES`. |
| 422 | The card is not valid (the error names each problem), its `landingUrl` is on a vidrev host, or there is no address for viewers (no `landingUrl` and no default target URL). |
| 429 | More than 120 calls a minute with one token. |

The token, codes and API keys never go into chat, logs or commits. vidrev stores only their hashes.
