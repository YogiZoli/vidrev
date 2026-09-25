# GoHighLevel connector: owner setup

One HighLevel Marketplace app, created **Private** now and switched to Public in Phase 10 (DECISIONS Q-17 b). It only connects a creator's sub-account; billing stays in your own checkout. About 15 minutes.

## 1. Create the app

1. Open `https://marketplace.gohighlevel.com` and sign in with the HighLevel account that owns the agency (the developer portal is under **My Apps**).
2. **Create App**. Name: the product name in lowercase (`vidrev`). Never put "GHL" or "YouTube" in the name (D-23). App type: **Private**. Distribution: **Sub-Account** (location level).
3. **Advanced Settings, Auth**: set **Redirect URL** to your app address plus the callback path. It must match `APP_BASE_URL` exactly:

```text
<APP_BASE_URL>/api/oauth/ghl/callback
```

4. **Scopes**: tick exactly these (they are also sent in the install link, so the two lists must agree):

```text
contacts.readonly
contacts.write
opportunities.readonly
payments/transactions.readonly
locations.readonly
locations/customFields.readonly
locations/customFields.write
```

   If HighLevel names a scope differently in its list (for example `locations/custom-fields.readonly`), tick the name it shows and set the variable `GHL_SCOPES` on Railway to the space separated list you ticked. No deploy is needed beyond the restart.

5. **Advanced Settings, Webhooks**: set the default webhook URL to:

```text
<APP_BASE_URL>/api/hooks/ghl
```

   Subscribe to these events: `ContactCreate`, `ContactUpdate` (if offered), `ContactTagUpdate`, `OpportunityStatusUpdate` and the app uninstall event. Everything else is ignored. Webhooks are optional for correctness (the 5 minute sync covers contacts, opportunities and payments) but make tags and won deals show up in seconds.

6. Save. HighLevel shows the **Client ID** and **Client Secret** once. Copy them.

Private apps created after 2025-11-18 can be installed by at most 5 agencies. That covers your own account and the first testers; Phase 10 makes the app Public.

## 2. Give the app its secrets

From the repo root, in Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/set-secrets.ps1 -Ghl
```

Paste the Client ID, then the Client Secret (nothing is printed). Then redeploy both Railway services (or push to main). The **Connect GoHighLevel** button appears on `/app/integrations` once both values are set.

## 3. Connect your own sub-account

1. Sign in, open **Integrations**, press **Connect GoHighLevel**, pick the sub-account and allow.
2. Within a minute the page shows the sub-account name and "connected". The worker created the contact field `c2c_tid` (or reused yours) and ran the first sync.
3. Add the field to your opt-in form: in the form builder add a **hidden field** mapped to the contact field `c2c_tid` and set its **Query Key** to `c2c_tid`, so the form fills it from the page address. Or add the `<script src=".../c2c.js">` line shown on the Link domain page. Without either, we still read `utm_content` from the contact's attribution.

## 4. Check it works

- Click a tracked link, fill the form: a contact appears in HighLevel with the tags `c2c`, `c2c_kw_<keyword>`, `c2c_vid_<videoId>` and the `c2c_tid` field set; **Integrations, Recent deliveries** lists the delivery.
- Mark a contact as a buyer by adding the buyer tag (default `c2c_buyer`), or win an opportunity, or take a payment: within 5 minutes (seconds with webhooks) the buyer appears in `purchases`. Payments carry amount and currency; tags and won opportunities are buyers with revenue "not reported".
- Remove the app in HighLevel: the uninstall webhook wipes the stored tokens; without it the next sync fails and the creator gets a "Reconnect GoHighLevel" email.

## 5. Things to confirm on the first live run

The connector was built from the public OpenAPI files and tested against a faked HighLevel. These details can only be confirmed against a real location; each has a single place to change if HighLevel differs (`src/server/ghl/api.ts`, marked "verify live"):

| Detail | Assumption | If it differs |
| --- | --- | --- |
| Custom field response | `POST /locations/{id}/customFields` returns `{ customField: { id } }` | `createContactField` also accepts a bare object |
| Contact list | `GET /contacts/?locationId=` still works, newest first | Only new contacts are missed; webhooks and the payments and opportunities read still work. Switch `listContacts` to `POST /contacts/search` |
| Payment amounts | `amount` in `/payments/transactions` is in currency units (97 = 97.00) | Raw transactions are stored in `purchases.raw`; fix `syncTransactions` and re-run the 90 day pass |
| Refunds | a `refunds[]` array or status `refunded` | `refundedOf` in `src/worker/ghl.ts` |
| Webhook contact payload | only the contact id is trusted; the contact is read back through the API | none needed |
| Scope names | as listed above | `GHL_SCOPES` |
