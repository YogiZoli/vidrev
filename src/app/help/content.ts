// The Help page (app.vidrev.app/help). The Marketplace listing links here as
// its documentation URL, so the CRM is never named by platform (A-24). Menu
// names must match the app: To Approve, Automations, People, Reports, Settings.

export interface HelpSection {
  id: string;
  title: string;
  steps?: string[];
  notes?: string[];
}

export const HELP: HelpSection[] = [
  {
    id: "start",
    title: "Get started",
    steps: [
      "Sign in at app.vidrev.app with the link we email you (or your password, or Google).",
      "The setup guide opens on its own: connect your YouTube channel, then create your first automation.",
      "Optional: connect your CRM sub-account and Stripe, so opt-ins, buyers and revenue show up per video and keyword.",
    ],
  },
  {
    id: "youtube",
    title: "Connect your YouTube channel",
    steps: [
      "Settings, YouTube channel, Connect.",
      "Pick the Google account that owns the channel and allow the permission on Google's screen. Keep the comment permission ticked.",
      "The page shows how long connecting has taken; you can close it, connecting goes on by itself.",
    ],
    notes: [
      "\"The comment permission was unticked\": connect again and keep it ticked.",
      "\"This Google account has no channel\": sign in with the Google account that owns the channel (brand accounts: choose the channel on Google's list).",
      "\"Already connected to another account\": a channel belongs to one vidrev account. Disconnect it there first.",
    ],
  },
  {
    id: "automations",
    title: "Create an automation (video, keyword, link)",
    steps: [
      "Automations, New automation.",
      "Choose a video, or all your videos.",
      "Add a keyword viewers comment (for example GUIDE) and the page it should lead to.",
      "Write or approve the reply template. The tracked link is added for you.",
    ],
    notes: ["A keyword comment is found within minutes after a new upload, and within about 15 minutes on older videos."],
  },
  {
    id: "approve",
    title: "Approve replies",
    steps: [
      "To Approve lists every draft reply, with the comment and the video.",
      "Edit if you like, then Approve. Only approved replies are posted, one by one, from your channel.",
    ],
    notes: [
      "\"YouTube's daily limit\": the reply waits and goes out first after the daily reset, or post it yourself with one click.",
      "\"Monthly plan limit reached\": replies wait until the next month, or post them yourself.",
      "\"Comments are turned off on this video\" or \"the comment was deleted\": nothing to do, the reply is skipped.",
      "\"YouTube did not confirm the reply\": check the video and post it yourself if it is missing.",
    ],
  },
  {
    id: "crm",
    title: "Connect your CRM sub-account",
    steps: [
      "From the app: Settings, Connections, the CRM page, Connect. Choose one sub-account (not the agency).",
      "Or install the app from the Marketplace listing. Signed in to vidrev in the same browser: it connects at once. Not signed in: sign in in the same browser within 24 hours and press \"Connect to this account\".",
      "vidrev then creates the field \"vidrev tracking id\" and starts reading new contacts, won opportunities and payments every few minutes.",
    ],
    notes: [
      "One vidrev account connects one sub-account. For another sub-account, use a different vidrev account, or disconnect the current one first.",
      "\"Install the app on one sub-account\": an agency-level install is not supported; install it on the sub-account.",
      "\"This install link has expired\": install the app again from your CRM.",
      "An email or status saying the CRM refused the connection: connect again; nothing recorded is lost.",
    ],
  },
  {
    id: "links",
    title: "Tracked links and your own domain",
    steps: [
      "Every reply carries a short tracked link. By default it runs on the shared link domain.",
      "Settings, Linked domain: add a subdomain of a domain you own (for example go.yourdomain.com) and add the one CNAME record it shows. Within minutes the page says Live and new replies use it.",
      "Settings, Linked domain also shows the vidrev.js snippet: put it on your opt-in page so a sign-up is matched to the comment and the video.",
    ],
  },
  {
    id: "reports",
    title: "Reports",
    steps: [
      "Reports shows clicks, subscribers, buyers and revenue per video and keyword. Numbers come only from real events, never estimates.",
      "People shows each person's path: comment, reply, click, opt-in, purchase.",
    ],
  },
  {
    id: "disconnect",
    title: "Disconnect or delete",
    steps: [
      "YouTube: Settings, YouTube channel, Disconnect. Access is revoked and the channel's YouTube data is deleted at once.",
      "CRM: Settings, the CRM page, Disconnect, or uninstall the app in your CRM. In Beast Mode, delete the vidrev contacts first with the button shown there.",
      "Stripe: Settings, Stripe, Disconnect.",
      "Everything: Settings, Account, Delete my account. See Data deletion for what is deleted.",
      "Subscription: Settings, Billing and cancel, or the manage link in your receipt email.",
    ],
  },
  {
    id: "errors",
    title: "Something went wrong",
    notes: [
      "\"That did not go through\" with a reference: go back and try once more. If it repeats, send us the reference; it points to the exact log line.",
      "A page that says how long something has run (connecting, an audit) can be closed; the work goes on by itself and stops on its own if it takes too long.",
    ],
  },
];
