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
