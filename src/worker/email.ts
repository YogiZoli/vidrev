import type { SendEmailJob } from "@/jobs/queues";
import type { FetchLike } from "@/server/google/oauth";

// Resend's shared test sender works before a domain is verified, but only
// delivers to the Resend account owner's own address.
export const FALLBACK_SENDER = "onboarding@resend.dev";

export function senderAddress(emailFrom: string | undefined, productName: string): string {
  return emailFrom ?? `${productName} <${FALLBACK_SENDER}>`;
}

export class EmailSendError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "EmailSendError";
  }
}

export async function sendWithResend(
  job: SendEmailJob,
  config: { apiKey: string; from: string },
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const response = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ from: config.from, to: [job.to], subject: job.subject, text: job.text, html: job.html }),
  });
  const json = (await response.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!response.ok) throw new EmailSendError(response.status, json.message ?? `Resend HTTP ${response.status}`);
  return json.id ?? "";
}
