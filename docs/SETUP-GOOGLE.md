# Google Cloud setup: the app project and OAuth client

This is the product's own GCP project (D-27, D-31): one project, shared by all customers, for reading comments and posting approved replies. "Audit my channel" has its own, separate project ([SETUP-AUDIT.md](SETUP-AUDIT.md), D-34, Phase 9). Never create a second project for the same purpose.

Do these steps signed in with the Google account that will own the product (the owner's account, not a customer's).

## 1. Create the project

1. Open https://console.cloud.google.com/projectcreate
2. Project name: `c2c-app`. Organization: "No organization" is fine.
3. Create, then make sure `c2c-app` is selected in the project picker at the top.

Do not put "YouTube", "YT" or "Tube" in project, app or client names (D-23).

## 2. Enable the YouTube Data API

1. Open https://console.cloud.google.com/apis/library/youtube.googleapis.com
2. Click **Enable**. The default quota is 10,000 units per day.

## 3. Configure the Google Auth Platform (consent screen)

1. Open https://console.cloud.google.com/auth/overview and click **Get started**.
2. App information: app name = the working product name (it can be changed later; no "YouTube" in it), user support email = the owner's email.
3. Audience: **External**.
4. Contact information: the owner's email.
5. Accept the Google API Services User Data Policy yourself, then **Create**.

## 4. Scopes (Data Access)

1. Open https://console.cloud.google.com/auth/scopes
2. **Add or remove scopes**, tick exactly these, then **Update** and **Save**:
   - `openid`
   - `.../auth/userinfo.email`
   - `.../auth/userinfo.profile`
   - `https://www.googleapis.com/auth/youtube.force-ssl`

Nothing else. The app never asks for more (SPEC section 7).

## 5. Test users (Audience)

1. Open https://console.cloud.google.com/auth/audience
2. Publishing status stays **Testing** until the brand domain, Privacy Policy and Terms exist (compliance pack after Phase 5).
3. Under **Test users**, add the owner's email and the Google account that owns the owner's channel (if different). Up to 100 test users.

In Testing mode Google expires refresh tokens after 7 days, so a connected channel has to be reconnected weekly until the app is verified. The app shows "revoked" and a Connect button when that happens.

## 6. OAuth client

1. Open https://console.cloud.google.com/auth/clients and click **Create client**.
2. Application type: **Web application**. Name: `c2c-saas web`.
3. Authorized redirect URIs, add both:
   - `https://web-production-7b0e1f.up.railway.app/api/oauth/google/callback`
   - `http://localhost:3000/api/oauth/google/callback`
4. **Create**. Copy the Client ID and the Client secret right away (download the JSON as a backup and keep it out of the repo).

When the brand domain exists, add `https://app.<brand domain>/api/oauth/google/callback` here and set `APP_BASE_URL` to match.

"Continue with Google" on /login and /signup (DECISIONS A-18) uses the same client with its own redirect URI. Add it next to the others, or Google answers `redirect_uri_mismatch`:

- `https://app.vidrev.app/api/auth/google/callback`
- `http://localhost:3100/api/auth/google/callback` (local preview)

It asks only `openid email profile` (no sensitive scope, no extra review).

## 7. Put the values into Railway

From the repo root, in Windows PowerShell:

```powershell
cd C:/Users/gdp/repos/c2c-saas
powershell -ExecutionPolicy Bypass -File scripts/set-secrets.ps1
```

The script sets `ENCRYPTION_KEY`, `AUTH_SECRET` and `PROVISIONING_SECRET` if they are missing, then asks for `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (input hidden) and sets them on both services. It never prints a secret.

## 8. Check

1. Sign in at `https://web-production-7b0e1f.up.railway.app/login` with the owner email.
2. On `/app`, click **Connect your channel**, choose the channel's Google account, keep every box ticked, allow.
3. The channel shows "Connecting..." for a few seconds, then its title and "connected". One `channels.list` call (1 unit) is written to `quota_ledger`.
