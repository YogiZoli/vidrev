# vidrev Privacy Policy

<!-- DRAFT, needs legal review. Not published. The {{TOKENS}} are filled from docs/compliance/legal-entity.json by design/legal/build-legal-kit.py; the text is the same for any company form. To be published at https://vidrev.app/privacy. -->

Effective date: {{EFFECTIVE_DATE}}

This policy explains how {{OPERATOR_NAME}} ("vidrev", "we") handles data when you use vidrev at vidrev.app and app.vidrev.app, and when someone clicks a vidrev tracked link.

## 1. Who we are

vidrev helps YouTube creators reply to keyword comments with approved replies and measure which videos and keywords bring subscribers, buyers and revenue. Operator: {{OPERATOR}}. Contact for anything in this policy, including data protection requests: {{CONTACT_EMAIL}}.

**Roles.** For your account data we are the controller. For data about the people who comment on your videos, click your links, opt in or buy (your viewers and contacts), you are the controller and we process it on your behalf, as your processor, only to provide vidrev. A data processing agreement is available on request.

## 2. YouTube API Services

vidrev uses YouTube API Services. By connecting a YouTube channel you agree to the YouTube Terms of Service (https://www.youtube.com/t/terms). Google's handling of your data is described in the Google Privacy Policy (https://policies.google.com/privacy).

You can revoke vidrev's access to your Google account at any time at https://myaccount.google.com/permissions, or by clicking "Disconnect" in vidrev. Either way we stop all access and delete the YouTube data described in section 4.

## 3. What we collect

**From you (the creator):**
- Account data: email address, plan, sign-in times.
- Google account data through OAuth: your YouTube channel id and title, and an access token for the scope `youtube.force-ssl`, stored encrypted (AES-256-GCM).
- Your settings: keywords, reply templates, destination URLs, link domain, and optionally your own AI provider key (stored encrypted).

**From YouTube, on your behalf (YouTube API data):**
- Top-level comments on your videos that contain one of your keywords: comment text, commenter display name and channel id, video id and title, published time. Comments without a keyword are read but not stored.
- The ids of replies we post for you.

**First-party data we create:**
- Replies you approved (text, keyword, language, time of approval and sending).
- Clicks on your tracked links: time, link, keyword, video id, a daily-changing one-way hash of the IP address (the IP itself is not stored), browser type, country, referring site. Automated clicks (bots) are marked.
- If you connect Stripe: a restricted read-only key you create (stored encrypted, deleted when you disconnect), and, read from your Stripe account, each payment's id, amount, currency, refunds, time, the buyer's email and name, the Stripe customer id and any tracking id you put in the metadata. We do not store card details, and the key cannot change anything in your Stripe account.
- If you use the free channel audit (no account needed): the channel handle you typed, and public YouTube data read with an API key: the channel and video titles, the last five videos' descriptions and links, and the last comments on those videos. Comment text is analysed and not stored. What we keep is counts and a score; video titles, comment ids and description links are deleted 30 days after they were read. If you ask for the full report by email, we keep the email address you entered, whether you ticked the separate box for occasional tips (and when), and we send the report to that address only.
- Phone numbers and messaging handles: if you give us your phone number, WhatsApp number or Telegram username (for example for support or account notices), we keep it with your account. If your own opt-in pages or CRM send us a contact's phone number, we store it with that contact like an email address, only to attribute the opt-in or purchase.
- Opt-ins and purchases your own systems send us (through our inbound webhooks or a connected GoHighLevel account): email address, name if you send it, the tracking id, order id, amount, currency, refunds and time. We use them only to show you which video and keyword brought them. If you connect GoHighLevel we also store its access tokens, encrypted, and read the contacts, won opportunities and payments of the one sub-account you connect.

## 4. Data retention (YouTube API data: 30 days)

- YouTube API data (comment text, commenter names and channel ids, video and channel titles, reply ids) is deleted or refreshed within 30 days of being fetched. A daily job enforces this.
- Recognising a returning commenter: to know that two keyword comments on different videos come from the same person, we keep the commenter's YouTube channel id, and the id of the comment that showed it, as a key on one contact record (one record per person, so an opt-in or a second comment updates that record and never creates a duplicate). We confirm the id with YouTube every 30 days (a read of that comment); if the comment is gone or the author differs, the id is deleted. We never show this id in the app, never send it to any other system, and never use it to look for the person elsewhere. If you disconnect YouTube, these ids are deleted at once. The email a person gives on your opt-in page is kept on the same contact record, because that is how one person's comments, clicks, opt-in and purchase are shown as one story in your reports.
- When you disconnect YouTube or revoke access, all YouTube-derived data of that channel is deleted at once (always within 7 days).
- First-party data (replies you approved, clicks, opt-ins, purchases, aggregate counts) is kept while your account is active, so your reports stay complete.
- If you install vidrev from the HighLevel Marketplace without being signed in, the access grant waits sealed for at most 24 hours for you to claim it and is then deleted. Uninstalling vidrev in HighLevel or removing the connection in vidrev deletes the stored tokens; contacts and tags already written to your own HighLevel account stay there, they are yours.
- When you close your account, all data of the account is deleted within 30 days, except records we must keep by law (e.g. invoices).

## 5. How we use data

- To find keyword comments, draft replies, show them for your approval and post only the replies you approve.
- To redirect tracked links and count clicks, subscribers, buyers and revenue per video and keyword.
- To run the service: sign-in emails, notifications, security, abuse prevention, support.

We never sell data, never use it for advertising, and never use Google user data to train AI models.

## 6. Google API Services User Data Policy (Limited Use)

vidrev's use and transfer of information received from Google APIs to any other app will adhere to the Google API Services User Data Policy (https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.

In particular: we use Google user data only to provide the features you see in vidrev; we transfer it only as needed for those features, for security, or to comply with law; we do not use it for advertising; humans do not read it unless you ask us to (support), it is needed for security or by law, or it is aggregated and anonymized.

## 6a. How we communicate (email, phone, SMS, WhatsApp, Telegram)

- **With you (account holders):** we send sign-in links, receipts, reports and service notices by email. If you give us a phone number, WhatsApp number or Telegram username, we may use it for support and important account notices. We send marketing messages on any channel only with your consent, and you can stop them at any time (unsubscribe link, reply STOP to an SMS, tell us on WhatsApp or Telegram, or write to {{CONTACT_EMAIL}}). Messages your account needs (sign-in, billing, security) are not marketing.
- **Support:** if you contact us by email, phone, WhatsApp or Telegram, we keep the conversation as long as needed to help you and at most 2 years, then delete it. WhatsApp is run by Meta (https://www.whatsapp.com/legal/privacy-policy) and Telegram by Telegram Messenger (https://telegram.org/privacy); their own policies apply to what passes through their apps.
- **With your contacts:** vidrev does not send SMS, WhatsApp or Telegram messages to your viewers or contacts. If you message them through your own CRM or tools, you are the sender and you are responsible for their consent and opt-out under the rules that apply to you (for example GDPR, ePrivacy, TCPA, CAN-SPAM).
- We never sell or share phone numbers or messaging handles, and never use them for advertising.

## 7. AI drafting

To draft a reply, the comment text and your approved templates are sent to an AI model. The commenter's name is never sent. By default we use Google Gemini through a paid Google Cloud project, under terms that do not allow Google to train on this data. If you add your own key (Anthropic, OpenAI or Google Gemini), drafts are made with that provider under your agreement with them. Every draft needs your approval before anything is posted.

## 8. Cookies

- app.vidrev.app uses one session cookie to keep you signed in.
- When a viewer clicks a tracked link on your own domain, we set a first-party cookie `vidrev_tid` (a random click id, 180 days) on your domain, so your opt-in page can attribute a later sign-up. It contains no personal data. The optional `vidrev.js` script reads it on your own pages.

## 9. Who processes data for us

| Provider | Purpose | Location |
| --- | --- | --- |
| Railway | Hosting, database | United States |
| Cloudflare | DNS, TLS, link routing | Global |
| Resend | Sending emails | United States |
| Google (Gemini API) | AI drafts (default) | United States |
| Anthropic, OpenAI | AI drafts, only with your own key | United States |

### Data we send to systems you choose

If you add a webhook endpoint or connect GoHighLevel, we send events to it: that a keyword comment on your video matched one of your keywords (without the comment or its author), that a reply was posted, that a link was clicked, that a subscriber opted in, that a buyer purchased. Events carry your keyword, the id of your own video, our tracking id, our opaque contact id and, for subscribers and buyers, the email address, name and amount that your own opt-in page or checkout collected. Delivery logs are kept for 30 days. You can remove an endpoint or disconnect GoHighLevel at any time; we then delete the stored tokens and signing secret and stop sending.

In GoHighLevel we create or update one contact per email address, only when a person opts in or buys (never for a comment alone), set the "vidrev tracking id" field and add these tags: `vidrev`, `vidrev-source-youtube`, `vidrev-keyword-<keyword>`, `vidrev-temperature-<cold, warm or hot>-lead`, `vidrev-video-<video id>` and `vidrev-buyer`. The keywords, temperature and videos come only from the vidrev links this person clicked in the 30 days before the opt-in or purchase: our own first-party click records, not data read from YouTube.

### Beast Mode (optional, chosen by you)

By default (Clean Mode) a commenter reaches your CRM only after they opt in. If you choose Beast Mode, which you must confirm after a warning, every viewer who comments one of your trigger keywords becomes a contact in your connected GoHighLevel account when we see the comment:

- What we send: the commenter's YouTube display name, the tags `vidrev-prospect`, `vidrev-keyword-<keyword>`, `vidrev-temperature-<cold, warm or hot>-lead` and `vidrev-video-<video id>`, and a "vidrev prospect id" field (our own random id). No email, no phone, no YouTube channel id.
- A conversation thread in GoHighLevel holds the comment text, a link to your video and our suggested reply. You approve or write the reply there; we post it to YouTube only after you send it, through the same approval as in vidrev.
- 29 days: a Beast Mode contact that has not opted in is deleted from your GoHighLevel account together with its thread between the 28th and the 29th day, so this YouTube API data never stays there longer than 29 days. We delete only contacts we created ourselves, checked twice before each delete, and never a contact that has an email or a phone number. A copy of a deleted contact is kept for at most 23 hours, and never past the 29th day, so a mistaken delete can be undone, then removed. If the delete in GoHighLevel keeps failing until the 29th day, we still remove everything on our side.
- Opt-in: when the person opts in with their email, the tags move to the contact with that email, a new thread there lists only your own replies (video, keyword, date, reply text, never the comment text), and the Beast Mode contact is deleted.
- Before you disconnect GoHighLevel, vidrev offers to delete the Beast Mode contacts it created, because after the disconnect it can no longer reach them.
- Switching back to Clean Mode stops new Beast Mode contacts; the existing ones still follow the 29 day rule.

### What never leaves vidrev

Except in Beast Mode (above), data we read through the YouTube API Services about viewers is never sent to you, to GoHighLevel, to a webhook or to anyone else: not the comment text, not the commenter's name, not the commenter's YouTube channel id, not the fact that a particular person commented. In Beast Mode the display name and comment text go only to your own connected GoHighLevel account, as described above, and never the channel id. It is used only inside vidrev to draft the reply you approve and to recognise the same person for at most 30 days (section 4), and it is deleted as section 4 describes. Outside Beast Mode, nothing we send to a system you connect needs to be deleted after 30 days, because none of it is YouTube API data about viewers; the Beast Mode data is deleted on the 29th day as described above.

## 10. Viewers who click links or comment

If you commented on a creator's video or clicked a creator's link, the creator decides why the data is used; we process it on their behalf. A comment alone puts you in the creator's CRM only if the creator turned on Beast Mode (section 9): then your YouTube display name, the keyword and the comment appear there for at most 29 days, and are deleted unless you opt in. Otherwise you enter the creator's CRM only when you give your email on the creator's own page. Contact the creator, or write to {{CONTACT_EMAIL}} and we forward your request.

## 11. Legal bases (EU and UK GDPR)

- **Contract:** to run your account and the features you use (sections 3 to 5).
- **Legitimate interests:** security, abuse prevention, fixing errors and improving the service, balanced against your rights.
- **Consent:** optional marketing messages on any channel, and the audit tips box. You can withdraw consent at any time; this does not affect what happened before.
- **Legal obligation:** records we must keep by law, such as invoices.

## 11a. International transfers

Our providers (section 9) are mostly in the United States. Where data from the EU, the UK or Switzerland is transferred, we rely on an adequacy decision (including the EU-US Data Privacy Framework where the provider is certified) or on the European Commission's Standard Contractual Clauses with the UK Addendum.

## 11b. Your rights

You can access, export, correct or delete your data from your account, or by writing to {{CONTACT_EMAIL}} or through any channel in section 6a. We answer within 30 days (45 days where US state law allows).

- **EU and UK (GDPR):** access, rectification, erasure, restriction, portability, objection (to direct marketing at any time), withdrawal of consent, and a complaint to your data protection authority.
- **US states (California CCPA/CPRA and other state privacy laws):** the right to know what personal information we collect, use and disclose, to delete it, to correct it, and to opt out of its sale, of sharing for cross-context behavioural advertising and of profiling. We do not sell or share personal information and do not use it for targeted advertising or profiling. We will not treat you differently for using these rights. Categories we collect: identifiers (email, name, phone number, messaging handle, account id), commercial information (plan, purchases), internet activity (sign-ins, link clicks), approximate location (country from the IP address; the IP is not stored) and content you create (replies, settings). Sources and purposes are in sections 3 to 5, recipients in section 9. You may use an authorised agent; we may verify a request through your account email.
- **Viewers and contacts of a creator:** send your request to the creator, or to {{CONTACT_EMAIL}} and we pass it on and help the creator answer it.

## 12. Security

Tokens and keys are encrypted at rest, traffic uses TLS, access is limited to what the service needs.

## 13. Children

vidrev is for creators aged 18 and over.

## 14. Changes

We will email account holders about material changes before they take effect.
