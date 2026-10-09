// The Trust page (app.vidrev.app/trust): how vidrev handles access, data and
// security, written for creators. The same answers are what the Google OAuth
// and the Marketplace reviews ask (docs/compliance/REVIEW-ANSWERS.md points
// here), so a reviewer and a customer read one text. The CRM is never named
// by platform here: the Marketplace listing links to this page (A-24).

export interface Permission {
  scope: string;
  why: string;
}

export const GOOGLE_SCOPES: Permission[] = [
  {
    scope: "youtube.force-ssl",
    why: "Read new comments on your own channel to find your keywords, and post the replies you approve, one by one. YouTube offers no narrower permission that can post a reply. vidrev never likes, subscribes, deletes or changes anything else.",
  },
  { scope: "openid, email, profile", why: "Know which Google account connected the channel and show it to you." },
];

export const CRM_SCOPES: Permission[] = [
  { scope: "contacts.readonly", why: "Find the tracking id and the buyer tag on contacts created by your own opt-in forms." },
  { scope: "contacts.write", why: "Create or update the contact of a person who opted in or bought through your tracked link, add the vidrev tags and the optional source note." },
  { scope: "opportunities.readonly", why: "Count a won opportunity as a buyer. Its value is never counted as revenue." },
  { scope: "payments/transactions.readonly", why: "Read payments and refunds, so revenue is attributed to the video and keyword that brought it." },
  { scope: "locations.readonly", why: "Show the name and website of the connected sub-account." },
  { scope: "locations/customFields.readonly, locations/customFields.write", why: "Create and read the one field \"vidrev tracking id\" (and, in Beast Mode, \"vidrev prospect id\")." },
  {
    scope: "conversations.readonly, conversations.write, conversations/message.readonly, conversations/message.write",
    why: "Beast Mode only, which you switch on yourself: the comment thread where you approve or write the reply. Clean Mode never uses it.",
  },
];

export const STRIPE_ACCESS: Permission[] = [
  { scope: "Restricted key, read only (Charges, Customers, Invoices)", why: "Read payments and refunds for attribution. The key cannot change anything in your Stripe account; we store it encrypted and delete it when you disconnect." },
];

// YouTube API Services: what the policies ask and where vidrev does it.
export const YOUTUBE_POLICY: { rule: string; how: string }[] = [
  {
    rule: "Stored YouTube data is refreshed or deleted within 30 days",
    how: "A daily job deletes comment text, commenter names and ids, video and channel titles and reply ids once they are 30 days old. A returning commenter's id is checked with YouTube every 30 days and deleted when the comment is gone.",
  },
  {
    rule: "Disconnecting deletes the YouTube data",
    how: "Disconnect in Settings, or removing access at myaccount.google.com/permissions: we revoke the grant and delete all YouTube data of that channel at once. A refused revoke never blocks the deletion.",
  },
  { rule: "You can revoke access at any time", how: "Settings > YouTube channel > Disconnect, or https://myaccount.google.com/permissions." },
  { rule: "Links to the YouTube Terms and the Google Privacy Policy", how: "Both are linked in our Terms and Privacy Policy, and connecting a channel binds you to the YouTube Terms of Service." },
  { rule: "Nothing is posted without the user's action", how: "Every reply waits in your approval queue; only the reply you approve is posted, and there is a daily safety ceiling per channel." },
  {
    rule: "YouTube data is not sold, shared or used for ads",
    how: "Viewer data read through YouTube never leaves vidrev: not to you, not to your CRM, not to webhooks. The one exception is Beast Mode, which you switch on after a warning: the commenter's display name and comment reach only your own CRM, and are deleted there on day 29 unless the person opts in.",
  },
  { rule: "Limited Use of Google user data", how: "Used only for the features you see, never for advertising, never to train AI models, and read by people only for support you ask for, security or the law." },
  { rule: "Quota is used responsibly", how: "New uploads come by push and the free RSS feed, comments are polled often only in the 48 hours after an upload, ids are batched, and the app stops calling when the day's budget is used." },
];

export const SECURITY: { title: string; text: string }[] = [
  { title: "Encryption", text: "All traffic uses TLS. Google tokens, CRM tokens, Stripe keys, AI keys and webhook secrets are encrypted at rest with AES-256-GCM; the key lives only in the server environment." },
  { title: "Sign-in", text: "Magic links or a password stored as an scrypt hash, or Google sign-in. Sessions are server-side and can be ended by signing out." },
  { title: "Rotating tokens", text: "CRM refresh tokens are rotated under a database lock, so two workers can never use the same token. A refused token stops the connection and emails you once." },
  { title: "Verified webhooks", text: "Every incoming CRM webhook is checked against the platform's Ed25519 signature; every outgoing webhook is signed with your own secret." },
  { title: "Least access", text: "We ask only for the permissions listed below, each with its reason. Only the owner can reach production; every admin action is written to an audit log." },
  { title: "Monitoring", text: "The app and the worker are monitored every 5 minutes; failures are logged with a reference you can quote to support." },
  { title: "Where data lives", text: "Railway (hosting and database, United States), Cloudflare (DNS, TLS, links), Resend (email). The full list is in the Privacy Policy." },
];

export const FAQ: { q: string; a: string }[] = [
  {
    q: "Does vidrev post anything without me?",
    a: "No. Every reply is a draft until you approve that specific reply. vidrev never likes, subscribes, deletes or edits anything on YouTube.",
  },
  {
    q: "Do you read my viewers' comments?",
    a: "Only top-level comments on your own videos, to find your keywords. Comments without a keyword are not stored. Comment data is deleted within 30 days.",
  },
  {
    q: "What goes into my CRM?",
    a: "In Clean Mode (the default) only people who opted in or bought through your own pages: their email, name, the vidrev tags and the tracking field. In Beast Mode, which you switch on yourself, a commenter's display name and comment also go there, and are deleted on day 29 unless the person opts in.",
  },
  {
    q: "What happens when I uninstall the app from my CRM?",
    a: "We delete our copy of the access tokens at once, together with any install still waiting to be claimed, and stop every sync. Contacts and tags we wrote stay in your CRM, because they are yours. The results your campaigns produced (which video and keyword brought an opt-in or a sale) stay in your vidrev reports until you delete your account.",
  },
  {
    q: "What happens when I disconnect YouTube?",
    a: "We revoke the access and delete all YouTube data of that channel at once. Your replies, clicks, opt-ins and sales stay in your reports.",
  },
  {
    q: "How do I delete everything?",
    a: "Settings > Account > Delete my account. It starts at once, finishes within minutes, and you get a confirmation email. See the Data deletion page for what is deleted.",
  },
  {
    q: "Do you use my data to train AI?",
    a: "No. Drafts are written by an AI model under terms that do not allow training on your data; the commenter's name is never sent. If you add your own AI key, your agreement with that provider applies.",
  },
  {
    q: "Do you sell or share data?",
    a: "No. We never sell data, never use it for advertising, and never share it except with the providers that run the service.",
  },
  {
    q: "Can I connect more than one CRM sub-account?",
    a: "One per vidrev account. To connect another sub-account, use a different vidrev account, or disconnect the current one first.",
  },
];
