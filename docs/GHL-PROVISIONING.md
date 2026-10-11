# GHL provisioning webhook

Billing lives in GoHighLevel (SPEC section 6). GHL workflows tell the app what happened with a Custom Webhook action. The app never charges anyone and never rejects a paid purchase for capacity reasons (DECISIONS Q-20).

## Endpoint

- `POST {APP_BASE_URL}/api/provisioning/ghl`
- Header `Authorization: Bearer <PROVISIONING_SECRET>` (the value from Railway, service `web`, Variables).
- Header `Content-Type: application/json`.
- Optional header `X-Signature`: hex HMAC-SHA256 of the raw body with the same secret. GHL's Custom Webhook cannot sign bodies, so the Bearer secret is the main check (DECISIONS Q-04). If the header is sent, it must be valid.

## Body

```json
{
  "event": "purchase",
  "external_id": "{{order.id}}",
  "email": "{{contact.email}}",
  "name": "{{contact.name}}",
  "plan_code": "founding",
  "subscription_id": "{{subscription.id}}",
  "occurred_at": "",
  "trial_ends_at": ""
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `event` | yes | `purchase`, `subscription_created`, `trial_started`, `plan_changed`, `subscription_cancelled`, `payment_failed` |
| `external_id` | yes | Unique id of this occurrence (order, transaction or invoice id). Together with `event` it is the idempotency key, so a resend is harmless. Use an id that changes for every payment, not the subscription id. |
| `email` | yes | The buyer's email; it becomes the login email. |
| `name` | no | Buyer name. |
| `plan_code` | for purchase, subscription_created, trial_started, plan_changed | One of `standard_monthly`, `founding`, `ghl_affiliate_free`, `enterprise`, `internal`. Hardcode it per workflow. |
| `subscription_id` | recommended | Stored on the account. A cancellation or failed payment only suspends the account when it matches, so cancelling an old plan after an upgrade does not suspend the new one. |
| `trial_ends_at` | no | ISO date. Default: 14 days after the event (D-37). |

Empty merge fields (`""`) are treated as missing. The merge field names above are examples; pick the matching fields in the GHL workflow editor for each trigger.

## Workflows to build in GHL

| GHL trigger | `event` | `plan_code` |
| --- | --- | --- |
| Standard checkout with trial started | `trial_started` | `standard_monthly` |
| Payment received for the standard product | `purchase` | `standard_monthly` |
| Payment received for the founding product (no trial, DECISIONS Q-16) | `purchase` | `founding` |
| Subscription cancelled | `subscription_cancelled` | (empty) |
| Payment failed | `payment_failed` | (empty) |

Every renewal payment can send `purchase` again with its own `external_id`: an active account stays as it is, a suspended account is reactivated and gets a sign-in link.

## What the app does

| Event | Result |
| --- | --- |
| `purchase`, `subscription_created` | New email: account on the plan plus a welcome sign-in link. Existing: plan set, trial cleared, reactivated if suspended (new sign-in link). |
| `trial_started` | New account with `trial_ends_at`. Ignored for an account that already pays. Rejected (422) for `founding`. |
| `plan_changed` | Plan switched. |
| `subscription_cancelled`, `payment_failed` | Account suspended: no polling, no sending, reports kept. |

Responses: `200 {"result": ...}` (including `duplicate` for a resend), `401` wrong secret, `400` invalid body, `422` unknown plan code or founding trial. A 422 emails the owners in `ADMIN_EMAILS` and is not stored, so resending the same event after fixing the workflow works. Founding sales email the owners at 90 and at 100 seats.

## Test from PowerShell

```powershell
$secret = Read-Host "PROVISIONING_SECRET"
$body = '{"event":"purchase","external_id":"test-001","email":"you@example.com","plan_code":"standard_monthly"}'
Invoke-RestMethod -Method Post -Uri "https://app.vidrev.app/api/provisioning/ghl" -Headers @{ Authorization = "Bearer $secret" } -ContentType "application/json" -Body $body
```
