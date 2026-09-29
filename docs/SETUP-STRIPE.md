# Stripe: connect your payments (creator guide)

Connecting Stripe lets vidrev read your payments, so each video shows what it earned. It is read-only: the key you create can look at payments and nothing else. It cannot charge a card, refund, or change anything in your Stripe account.

Decisions behind this: [DECISIONS.md](../DECISIONS.md) section 15 (P8-01 to P8-09).

## 1. Create the restricted key (2 minutes, in your Stripe dashboard)

1. Open **Developers**, then **API keys**, then **Create restricted key**.
2. Name it `vidrev`.
3. Set **Read** access for these three, and leave everything else at **None**:
   - Charges
   - Customers
   - Invoices
4. Create the key and copy it. It starts with `rk_live_`.

Only live keys work. A test-mode key (`rk_test_`) is refused because only real revenue is counted. A full secret key (`sk_live_`) is refused because it could move money.

## 2. Paste it into vidrev

Open **Integrations**, find the Stripe card, paste the key, press **Connect Stripe**. Within a minute the card says "connected" and shows your account name. The key is stored encrypted and is never shown again; only its last 4 characters.

## 3. What happens next

- Payments of the last two years are read once, quietly: they show up in your reports, but no webhook and no GoHighLevel tag is triggered for old sales.
- Then new payments are read every 5 minutes. Refunds are picked up automatically.
- A payment is matched to a comment by the buyer's email (or the Stripe customer, or a `vidrev_tid` in the payment or customer metadata). If the same buyer already opted in through your tracked link, the payment lands on the same person, never on a duplicate.
- If the same sale also reaches vidrev from GoHighLevel or a webhook, it is counted once, and Stripe is the source of record.
- Subscriptions: renewals follow the first payment for as long as the subscription runs.

## 4. Optional: tell Stripe the tracking id

If your checkout is built with Stripe Checkout or a payment link, put the tracking id in the metadata as `vidrev_tid` (the value of the `vidrev_tid` URL parameter). It makes the match exact even when the buyer uses a different email at checkout. Without it, the email match still works.

## 5. Disconnect

Press **Disconnect** on the Integrations page. vidrev deletes the key it stored. To make sure the key can never be used again, also delete it in Stripe under Developers, API keys.

## If it stops

- "Stripe refused the key": the key was deleted, rolled or lacks a permission. Create a new one as in step 1 and paste it again. Nothing already recorded is lost.
- "This Stripe account is already connected to another vidrev account": one Stripe account can feed one vidrev account.

## Notes for the owner

- There is no platform setting to configure: the key belongs to the creator.
- Stripe pages are read with a pinned API version (`2024-06-20`, `src/lib/stripe.ts`), so a Stripe default change never changes the numbers.
- What only a real payment can confirm: that a restricted key with exactly Charges, Customers and Invoices read can list charges with `expand[]=data.customer` and `expand[]=data.invoice` (the connector relies on it), and whether such a key may read `/v1/account` (the account name; the connector works without it).
