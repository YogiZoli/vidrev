import type { SendEmailJob } from "@/jobs/queues";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function layout(productName: string, paragraphs: string[], button?: { label: string; url: string }): string {
  const body = paragraphs.map((p) => `<p style="margin:0 0 16px">${escapeHtml(p)}</p>`).join("");
  const cta = button
    ? `<p style="margin:24px 0"><a href="${escapeHtml(button.url)}" style="background:#111;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none">${escapeHtml(button.label)}</a></p>`
    : "";
  return `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#111;max-width:520px">${body}${cta}<p style="color:#666;font-size:13px">${escapeHtml(productName)}</p></div>`;
}

export function magicLinkEmail(input: { to: string; url: string; productName: string; welcome: boolean }): SendEmailJob {
  const intro = input.welcome
    ? `Your ${input.productName} account is ready.`
    : `Here is your sign-in link for ${input.productName}.`;
  const paragraphs = [intro, "The link works once and expires in 15 minutes.", "If you did not ask for this, you can ignore this email."];
  return {
    to: input.to,
    subject: input.welcome ? `Welcome to ${input.productName}` : `Sign in to ${input.productName}`,
    text: `${intro}\n\nSign in: ${input.url}\n\n${paragraphs.slice(1).join("\n")}\n`,
    html: layout(input.productName, paragraphs, { label: "Sign in", url: input.url }),
  };
}

export function ownerAlertEmail(input: { to: string; subject: string; lines: string[]; productName: string }): SendEmailJob {
  return {
    to: input.to,
    subject: `[${input.productName}] ${input.subject}`,
    text: `${input.lines.join("\n")}\n`,
    html: layout(input.productName, input.lines),
  };
}

// Mobile approval (R-35): one email when drafts are waiting, throttled.
export function draftsWaitingEmail(input: { to: string; count: number; url: string; productName: string }): SendEmailJob {
  const line = input.count === 1 ? "1 reply is waiting for your approval." : `${input.count} replies are waiting for your approval.`;
  const paragraphs = [line, "Nothing is posted until you approve each reply."];
  return {
    to: input.to,
    subject: `${line.replace(/\.$/, "")} - ${input.productName}`,
    text: `${paragraphs.join("\n")}\n\nReview: ${input.url}\n`,
    html: layout(input.productName, paragraphs, { label: "Review replies", url: input.url }),
  };
}

// The GoHighLevel connection was refused (app removed or access revoked).
export function ghlReconnectEmail(input: { to: string; url: string; productName: string }): SendEmailJob {
  const paragraphs = [
    "The connection to your GoHighLevel account stopped working, so new subscribers and buyers are no longer synced.",
    "Reconnect it in a minute. Nothing that was already recorded is lost.",
  ];
  return {
    to: input.to,
    subject: `Reconnect GoHighLevel - ${input.productName}`,
    text: `${paragraphs.join("\n")}\n\nReconnect: ${input.url}\n`,
    html: layout(input.productName, paragraphs, { label: "Reconnect", url: input.url }),
  };
}

// R-35 (3): the weekly summary, real numbers of the last 7 days only.
export function weeklySummaryEmail(input: { to: string; revenue: string; clicks: number; subscribers: number; buyers: number; url: string; settingsUrl: string; productName: string }): SendEmailJob {
  const headline = `This week your comments made ${input.revenue}.`;
  const paragraphs = [
    headline,
    `Last 7 days: ${input.clicks} clicks, ${input.subscribers} new subscribers, ${input.buyers} buyers.`,
    `You get this email on Mondays. Turn it off in your report settings: ${input.settingsUrl}`,
  ];
  return {
    to: input.to,
    subject: `${headline.replace(/\.$/, "")} - ${input.productName}`,
    text: `${paragraphs.join("\n\n")}\n\nFull report: ${input.url}\n`,
    html: layout(input.productName, paragraphs, { label: "See the full report", url: input.url }),
  };
}

const MILESTONE_LINES = {
  first_click: ["Someone clicked the link in one of your replies for the first time.", "From now on every click is counted per video and keyword."],
  first_subscriber: ["Your first subscriber came from a comment.", "A viewer who commented your keyword just joined your list."],
  first_buyer: ["Your first buyer came from a comment.", "A purchase was traced back to a comment reply. The report shows which video and keyword made it."],
} as const;

// R-35 (4): instant milestone notifications, each sent once.
export function milestoneEmail(input: { to: string; milestone: keyof typeof MILESTONE_LINES; url: string; productName: string }): SendEmailJob {
  const paragraphs = [...MILESTONE_LINES[input.milestone]];
  return {
    to: input.to,
    subject: `${paragraphs[0]!.replace(/\.$/, "")} - ${input.productName}`,
    text: `${paragraphs.join("\n\n")}\n\nReport: ${input.url}\n`,
    html: layout(input.productName, paragraphs, { label: "Open the report", url: input.url }),
  };
}

// R-35 (4): value recap before a yearly renewal.
export function renewalRecapEmail(input: { to: string; renewalDate: string; lifetime: string; price: string | null; productName: string; url: string }): SendEmailJob {
  const paragraphs = [
    `Your ${input.productName} membership renews on ${input.renewalDate}.`,
    `Since you joined, your comments made ${input.lifetime} in attributed revenue.`,
    ...(input.price ? [`Your renewal price stays at ${input.price}, locked for life.`] : []),
    "Nothing to do: the renewal runs through your original checkout.",
  ];
  return {
    to: input.to,
    subject: `Your year in numbers - ${input.productName}`,
    text: `${paragraphs.join("\n\n")}\n\nReport: ${input.url}\n`,
    html: layout(input.productName, paragraphs, { label: "See the report", url: input.url }),
  };
}
