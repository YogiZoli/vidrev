# Integrations guide

For creators and their web person. Everything here is also visible in the app under Integrations. Decisions behind it: [DECISIONS.md](../DECISIONS.md) section 11; technical background: [SPEC.md](SPEC.md) sections 9 to 11.

## 1. Events we send you (outbound webhooks)

Add an endpoint under Integrations. It must be a public `https` address. We send one `POST` per event with a JSON body.

| Event | When |
| --- | --- |
| `comment_matched` | A keyword comment got a draft. |
| `reply_posted` | A reply was posted (through the API or by you by hand). |
| `link_clicked` | A person clicked a tracked link. Bots are not sent. |
| `opt_in` | A subscriber was recorded. |
| `purchase` | A buyer was recorded. |

Body:

```json
{
  "event": "opt_in",
  "id": "5f0c6c1e-5c58-4f43-9a0e-2c1d9e1f8a10",
  "occurred_at": "2026-09-25T10:00:00.000Z",
  "account_id": "...",
  "channel_id": "...",
  "video_id": "dQw4w9WgXcQ",
  "campaign_id": "...",
  "campaign": "Free guide",
  "keyword": "GUIDE",
  "intent": "warm",
  "tid": "k3x9Tq2mPz",
  "email": "lea@example.com",
  "source": "webhook",
  "tags": ["c2c", "c2c_kw_guide", "c2c_vid_dQw4w9WgXcQ"]
}
```

`email` and `source` appear on `opt_in` and `purchase`; `amount_cents` and `currency` on `purchase` (`null` when the source did not report an amount: revenue is never estimated). `reply_id` appears when the event belongs to a reply. Events never contain comment text, commenter names or YouTube ids of commenters.

Headers: `X-Signature: sha256=<hex>`, `X-Event-Id` (same as `id`; ignore repeats), `X-Event-Name`.

### Verify the signature

The signature is the HMAC-SHA256 of the raw request body, made with the endpoint's signing secret (shown under Integrations, starts with `whsec_`). Compare in constant time, against the raw body, not a re-serialized one.

```js
import { createHmac, timingSafeEqual } from "node:crypto";

export function verify(rawBody, header, secret) {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const given = String(header ?? "").replace(/^sha256=/, "");
  return given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}
```

```python
import hmac, hashlib

def verify(raw_body: bytes, header: str, secret: str) -> bool:
    expected = hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest((header or "").removeprefix("sha256="), expected)
```

### Delivery and retries

Answer with any `2xx` within 10 seconds. Anything else (or no answer) is retried after 1 minute, 5 minutes, 15 minutes, 1 hour, 3 hours, 6 hours and 12 hours, so for about 22 hours. A `410 Gone` turns the endpoint off. Redirects are not followed. Use **Send test event** to check your setup (event `ping`).

### Tags

For CRMs with tags: `c2c` (from a comment), `c2c_kw_<keyword>` (letters and digits, no accents), `c2c_vid_<videoId>` and `c2c_buyer` (the person bought). Every event carries the matching list in `tags`. Some CRMs lowercase tags, so match people by `tid` or email, not by the video id inside a tag.

## 2. Tell us about subscribers and buyers (inbound hooks)

Two addresses on the app host, shown under Integrations together with your token:

- `POST /api/hooks/optin`: a subscriber signed up.
- `POST /api/hooks/purchase`: a buyer paid, or a payment was refunded.

Authenticate with the token: `Authorization: Bearer <token>`, or the header `X-Hook-Token`, or `?token=<token>` for tools that cannot set headers. If you also send `X-Signature: sha256=<HMAC-SHA256 of the raw body, key = your token>`, we verify it. JSON and `application/x-www-form-urlencoded` are accepted, up to 64 KB, 120 requests a minute.

### Subscriber

| Field | Notes |
| --- | --- |
| `email` | Required. |
| `c2c_tid` | The tracking id from your opt-in page (`tid` and `utm_content` also work). Without it we cannot attribute the subscriber to a video. |
| `name` | Optional (`first_name` and `last_name` also work). |
| `consent_marketing` | Optional true or false. Left unknown when not sent. |
| `external_id` | Optional id of the submission. Sending the same one again is ignored. |
| `occurred_at` | Optional timestamp. |

```bash
curl -X POST "$APP/api/hooks/optin" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"email":"lea@example.com","c2c_tid":"k3x9Tq2mPz","name":"Lea"}'
```

Answer: `{"ok":true,"created":true,"attributed":true}`. A tracking id that is unknown, or belongs to another account, gives `attributed: false`.

### Buyer

| Field | Notes |
| --- | --- |
| `email` or `c2c_tid` | At least one. |
| `external_id` | Required: the order or payment id. It makes retries safe and lets a later refund find the sale. |
| `amount` and `currency` | For example `97.00` and `USD`. Or `amount_cents`. Plain numbers only. Leave both out for a buyer without a reported amount. |
| `subscription_id` | For recurring payments. |
| `refunded_amount` | Total refunded so far. Send the same `external_id` again with it (and `type: "refund"`) to record a refund. |
| `occurred_at` | Optional timestamp. |

```bash
curl -X POST "$APP/api/hooks/purchase" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"email":"lea@example.com","external_id":"ord_1001","amount":"97.00","currency":"USD"}'
```

### Stripe

Stripe has its own connector: paste a read-only restricted key on the Integrations page and payments arrive by themselves, matched to the right video and person. See [SETUP-STRIPE.md](SETUP-STRIPE.md). Use `/api/hooks/purchase` only for other payment tools.

### GoHighLevel without the connector

In a workflow, add a **Custom Webhook** action: method `POST`, URL as above, header `Authorization: Bearer <token>`, body fields `email` = `{{contact.email}}`, `c2c_tid` = your custom field's merge tag. Trigger it on form submitted (subscriber) or on payment received (buyer, with `external_id` = the order or transaction id).
