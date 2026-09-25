# Owner setup: Audit my channel (separate GCP project and API key)

Audit my channel is a different use case from the customer app, so it has its own Google Cloud project and its own quota (D-34, D-31). Never reuse the `c2c-app` project for it, and never create a second project for the same purpose.

Decisions behind this: [DECISIONS.md](../DECISIONS.md) section 16 (P9-01 to P9-12). The page is `/audit` on the app host.

Do these steps signed in with the owner's Google account.

## 1. Create the audit project

1. Open https://console.cloud.google.com/projectcreate
2. Project name: `vidrev-audit`. Organization: "No organization" is fine.
3. Create, then make sure `vidrev-audit` is selected in the project picker at the top.

Do not put "YouTube", "YT" or "Tube" in the name (D-23).

## 2. Enable the YouTube Data API

1. Open https://console.cloud.google.com/apis/library/youtube.googleapis.com
2. Click **Enable**. The default quota is 10,000 units a day, about 750 audits (an audit reads at most 13 units).

## 3. Create the API key

1. Open https://console.cloud.google.com/apis/credentials
2. **Create credentials**, then **API key**. Copy it.
3. Open the key, **API restrictions**, choose **Restrict key**, tick only **YouTube Data API v3**, Save.

Leave application restrictions at "None": the calls come from Railway, which has no fixed address.

## 4. Put it on Railway

In the Railway project `c2c-saas`, add to **both** services (`web` and `worker`):

- `YT_API_KEY_AUDIT` = the key
- `AUDIT_DAILY_LIMIT` = `10000` (raise it only after Google grants more quota for this project)

The worker does the work, the web service only takes the request. Redeploy both.

## 5. Optional: Cloudflare Turnstile on the form

Stops bots from using up the daily quota. Skip it at first: without keys the form is protected by the 5 audits an hour per address limit and the 24 hour cache.

1. Open https://dash.cloudflare.com/?to=/:account/turnstile and **Add widget**.
2. Hostname: the app host (for example `app.vidrev.app`). Widget mode: Managed.
3. Copy the site key and the secret key.
4. On the `web` service add `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`. Both must be set for the check to be enforced.

## 6. Try it

1. Open `<app host>/audit`, enter a channel that has comments (for example your own) and press **Audit my channel**.
2. Within seconds the result page shows up to three findings. Enter an email to get the full report.
3. `/admin` shows requests, reports asked for, marketing consent and today's audit quota.

The first time, check three things against your own channel: the numbers of unanswered questions match what you see in YouTube Studio, the stack finding names the system your opt-in page runs on, and the link table lists the links of your descriptions.
