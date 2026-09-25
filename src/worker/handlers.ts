import type { PgBoss } from "pg-boss";
import { getDb } from "@/db/client";
import { type ChannelJob, QUEUES, QUEUE_OPTIONS, type SendEmailJob } from "@/jobs/queues";
import { env } from "@/lib/env";
import { errorFields, log } from "@/lib/log";
import { type ChannelDeps, disconnectChannel, syncChannel } from "./channels";
import { EmailSendError, senderAddress, sendWithResend } from "./email";

async function sendEmail(job: SendEmailJob): Promise<void> {
  const { RESEND_API_KEY, EMAIL_FROM, PRODUCT_NAME, NODE_ENV } = env();
  if (!RESEND_API_KEY) {
    if (NODE_ENV !== "production") {
      // Local development without Resend: print the email so magic links work.
      log("info", "email (not sent, no RESEND_API_KEY)", { to: job.to, subject: job.subject, text: job.text });
      return;
    }
    throw new Error("RESEND_API_KEY is not set");
  }
  try {
    const id = await sendWithResend(job, { apiKey: RESEND_API_KEY, from: senderAddress(EMAIL_FROM, PRODUCT_NAME) });
    log("info", "email sent", { id, subject: job.subject });
  } catch (error) {
    // 4xx (except rate limits) will not fix itself; log it and drop the job.
    if (error instanceof EmailSendError && error.status >= 400 && error.status < 500 && error.status !== 429) {
      log("error", "email rejected by Resend", { ...errorFields(error), status: error.status, subject: job.subject });
      return;
    }
    throw error;
  }
}

function channelDeps(): ChannelDeps | null {
  const { ENCRYPTION_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = env();
  if (!ENCRYPTION_KEY || !GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return null;
  return {
    db: getDb(),
    fetch,
    encryptionKey: ENCRYPTION_KEY,
    google: { clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET },
  };
}

function withChannelDeps(run: (deps: ChannelDeps, channelId: string) => Promise<void>) {
  return async ([job]: { data: ChannelJob }[]) => {
    const deps = channelDeps();
    if (!deps) throw new Error("Google OAuth or ENCRYPTION_KEY is not configured");
    await run(deps, job!.data.channelId);
  };
}

export async function registerHandlers(boss: PgBoss): Promise<void> {
  for (const [name, options] of Object.entries(QUEUE_OPTIONS)) {
    await boss.createQueue(name, options);
  }
  await boss.work<SendEmailJob>(QUEUES.sendEmail, async ([job]) => sendEmail(job!.data));
  await boss.work<ChannelJob>(QUEUES.channelSync, withChannelDeps(syncChannel));
  await boss.work<ChannelJob>(QUEUES.channelDisconnect, withChannelDeps(disconnectChannel));
}
