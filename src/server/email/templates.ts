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

export function passwordResetEmail(input: { to: string; url: string; productName: string }): SendEmailJob {
  const paragraphs = [`Set a new password for ${input.productName}.`, "The link works once and expires in 15 minutes.", "If you did not ask for this, you can ignore this email."];
  return {
    to: input.to,
    subject: `Reset your ${input.productName} password`,
    text: `${paragraphs[0]}\n\nSet password: ${input.url}\n\n${paragraphs.slice(1).join("\n")}\n`,
    html: layout(input.productName, paragraphs, { label: "Set password", url: input.url }),
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

export function accountDeletedEmail(input: { to: string; productName: string; supportEmail: string }): SendEmailJob {
  const paragraphs = [
    `Your ${input.productName} account has been closed and its data deleted, as you asked.`,
    "Your YouTube access was revoked and the YouTube data we held was deleted. Contacts that vidrev created in your CRM in Beast Mode were removed; contacts and tags of people who opted in or bought stay in your CRM, they are yours.",
    "If you pay through a subscription, cancelling it is a separate step: use the manage link in your purchase receipt email.",
    `Questions: ${input.supportEmail}. You do not need to do anything else.`,
  ];
  return {
    to: input.to,
    subject: `Your account is deleted - ${input.productName}`,
    text: `${paragraphs.join("\n")}\n`,
    html: layout(input.productName, paragraphs),
  };
}

export function stripeReconnectEmail(input: { to: string; url: string; productName: string }): SendEmailJob {
  const paragraphs = [
    "Stripe refused the key you connected, so new payments are no longer read.",
    "Check that the restricted key is still active and can read Charges, Customers and Invoices, then paste it again. Nothing that was already recorded is lost.",
  ];
  return {
    to: input.to,
    subject: `Reconnect Stripe - ${input.productName}`,
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

export interface AuditReportInput {
  to: string;
  productName: string;
  auditUrl: string;
  // Where "see how it works" leads (the brand site); no button when null.
  learnMoreUrl: string | null;
  channelLabel: string;
  auditedAt: Date;
  result: import("@/lib/audit/result").AuditResult;
  examples: import("@/lib/audit/result").AuditExamples;
}

const SEGMENT_LINE = {
  ghl: `Your pages run on GoHighLevel, which connects natively.`,
  other: `It works with any CRM or form tool through webhooks.`,
  none: `It works with any CRM or form tool through webhooks.`,
} as const;

// P9-10: the full audit report. Counts, the score with its factors, titles and
// links to the exact comments; never comment text.
export function auditReportEmail(input: AuditReportInput): SendEmailJob {
  const { result, examples, productName } = input;
  const commentUrl = (videoId: string, commentId: string) =>
    `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&lc=${encodeURIComponent(commentId)}`;
  const titleOf = (videoId: string) => examples.videos.find((v) => v.id === videoId)?.title || videoId;
  const date = input.auditedAt.toISOString().slice(0, 10);

  const sections: { heading: string; lines: string[] }[] = [];
  const score = result.score.value;
  sections.push({
    heading: score === null ? "Comment Conversion Score" : `Comment Conversion Score: ${score} out of 100`,
    lines:
      score === null
        ? ["There was not enough data for a score yet. It needs at least two of the four checks below to have something to measure."]
        : result.score.factors.map((f) => `${f.label}: ${f.ratio === null ? "not enough data" : `${Math.round(f.ratio * 100)}%`} (${f.detail})`),
  });
  sections.push({ heading: "What we found", lines: result.findings.length > 0 ? result.findings.map((f) => f.text) : ["Nothing to flag on this sample."] });
  if (result.keywords.length > 0) {
    sections.push({ heading: "Keyword candidates", lines: result.keywords.map((k) => `"${k.word}": ${k.comments} different comments`) });
  }
  if (examples.buying.length > 0) {
    sections.push({ heading: "Buying signals without a reply", lines: examples.buying.map((e) => `${titleOf(e.videoId)}: ${commentUrl(e.videoId, e.commentId)}`) });
  }
  if (examples.questions.length > 0) {
    sections.push({ heading: "Questions without a reply", lines: examples.questions.map((e) => `${titleOf(e.videoId)}: ${commentUrl(e.videoId, e.commentId)}`) });
  }
  if (examples.links.length > 0) {
    sections.push({
      heading: "Links in your descriptions",
      lines: examples.links.map((l) => {
        const facts = [l.measured ? "measured" : "not measured", l.ownDomain ? "your own domain" : "shared platform address", ...(l.stacks.length > 0 ? [`runs on ${l.stacks.join(", ")}`] : [])];
        return `${l.url} (${facts.join("; ")})`;
      }),
    });
  }
  sections.push({
    heading: "How this was measured",
    lines: [
      `Your last ${result.sample.videos} videos and ${result.sample.comments} public comments, read on ${date}. Pattern matching, not a judgement: a comment that "looks like" a buying signal may not be one.`,
      "We do not store comment text. Details from YouTube are deleted after 30 days.",
    ],
  });

  const intro = `Here is the full audit of ${input.channelLabel}.`;
  const outro = `${productName} measures which video makes money from your comments. ${SEGMENT_LINE[result.stack.segment]}`;
  const footer = `You asked for this report at ${input.auditUrl}. Reply to this email if you want it removed.`;

  const text = [intro, ...sections.map((s) => `${s.heading}\n${s.lines.map((l) => `- ${l}`).join("\n")}`), outro, input.learnMoreUrl ? `Learn more: ${input.learnMoreUrl}` : "", footer]
    .filter(Boolean)
    .join("\n\n");
  const body = sections
    .map((s) => `<h3 style="margin:24px 0 8px;font-size:16px">${escapeHtml(s.heading)}</h3><ul style="margin:0;padding-left:20px">${s.lines.map((l) => `<li style="margin:0 0 6px">${escapeHtml(l)}</li>`).join("")}</ul>`)
    .join("");
  const cta = input.learnMoreUrl
    ? `<p style="margin:24px 0"><a href="${escapeHtml(input.learnMoreUrl)}" style="background:#111;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none">See how ${escapeHtml(productName)} works</a></p>`
    : "";
  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#111;max-width:560px"><p style="margin:0 0 16px">${escapeHtml(intro)}</p>${body}<p style="margin:24px 0 16px">${escapeHtml(outro)}</p>${cta}<p style="color:#666;font-size:13px">${escapeHtml(footer)}</p></div>`;
  return { to: input.to, subject: `Your channel audit: ${input.channelLabel} - ${productName}`, text: `${text}\n`, html };
}

// A Video Publishing Card went live on a published video (DECISIONS A-33):
// which keywords now run on which video.
export function cardArmedEmail(input: {
  to: string;
  videoUrl: string;
  title: string | null;
  armed: string[];
  alreadyLive: string[];
  notArmed: { keyword: string; reason: string }[];
  url: string;
  productName: string;
}): SendEmailJob {
  const video = input.title ? `"${input.title}"` : "your new video";
  const lines = [
    `Publishing Dream Team published ${video}: ${input.videoUrl}`,
    ...(input.armed.length ? [`Now live on this video: ${input.armed.join(", ")}. Replies wait for your approval as always.`] : []),
    ...(input.alreadyLive.length ? [`Already watched by one of your automations, not duplicated: ${input.alreadyLive.join(", ")}.`] : []),
    ...input.notArmed.map((n) => `Not live: ${n.keyword}. ${n.reason}`),
  ];
  return {
    to: input.to,
    subject: `${input.productName}: ${input.armed.length ? `live on ${input.title ?? "your new video"}: ${input.armed.join(", ")}` : `card checked for ${input.title ?? "your new video"}`}`,
    text: `${lines.join("\n")}\n\nOpen ${input.productName}: ${input.url}\n`,
    html: layout(input.productName, lines, { label: "Open automations", url: input.url }),
  };
}
