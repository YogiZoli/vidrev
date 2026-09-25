import type { PgBoss } from "pg-boss";
import { getDb } from "@/db/client";
import { type ChannelJob, type CommentJob, type DomainJob, type ReplyJob, QUEUES, QUEUE_OPTIONS, type SendEmailJob } from "@/jobs/queues";
import { appBaseUrl, env } from "@/lib/env";
import { errorFields, log } from "@/lib/log";
import { type ChannelDeps, disconnectChannel, syncChannel } from "./channels";
import { EmailSendError, senderAddress, sendWithResend } from "./email";
import { createDraft } from "./drafts";
import { checkDomain, type DomainDeps, queueDomainChecks, removeDomainHostname } from "./domains";
import { runRetention } from "./retention";
import { sendReply } from "./sending";
import { checkRss, type EngineDeps, engineTick, pollChannel, renewWebsub } from "./polling";

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

function engineDeps(boss: PgBoss): EngineDeps | null {
  const deps = channelDeps();
  if (!deps) return null;
  return {
    ...deps,
    quotaLimit: env().QUOTA_DAILY_LIMIT,
    enqueue: async (queue, data, options) => {
      await boss.send(queue, data as object, options ?? {});
    },
  };
}

function domainDeps(boss: PgBoss): DomainDeps {
  const { CLOUDFLARE_API_TOKEN, CLOUDFLARE_ZONE_ID, CUSTOM_HOSTNAME_CNAME_TARGET } = env();
  return {
    db: getDb(),
    fetch,
    cloudflare: CLOUDFLARE_API_TOKEN && CLOUDFLARE_ZONE_ID ? { apiToken: CLOUDFLARE_API_TOKEN, zoneId: CLOUDFLARE_ZONE_ID } : null,
    cnameTarget: CUSTOM_HOSTNAME_CNAME_TARGET ?? null,
    appBaseUrl: appBaseUrl(),
    enqueue: async (queue, data, options) => {
      await boss.send(queue, data as object, options ?? {});
    },
  };
}

function withEngineDeps<T>(boss: PgBoss, run: (deps: EngineDeps, data: T) => Promise<void>) {
  return async ([job]: { data: T }[]) => {
    const deps = engineDeps(boss);
    if (!deps) throw new Error("Google OAuth or ENCRYPTION_KEY is not configured");
    await run(deps, job!.data);
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

  // Comment engine (SPEC section 7). The tick queues due polls and RSS
  // checks every minute; push leases are renewed hourly.
  await boss.work<ChannelJob>(QUEUES.channelPoll, withEngineDeps(boss, (deps, data: ChannelJob) => pollChannel(deps, data.channelId)));
  await boss.work<ReplyJob>(QUEUES.replySend, withEngineDeps(boss, (deps, data: ReplyJob) => sendReply(deps, data.replyId)));
  await boss.work<ChannelJob>(QUEUES.channelRss, withEngineDeps(boss, (deps, data: ChannelJob) => checkRss(deps, data.channelId)));
  await boss.work<CommentJob>(QUEUES.replyDraft, async ([job]) => {
    const { ENCRYPTION_KEY, GEMINI_PLATFORM_API_KEY, AI_PLATFORM_MODEL, PRODUCT_NAME } = env();
    await createDraft(
      {
        db: getDb(),
        fetch,
        encryptionKey: ENCRYPTION_KEY,
        platformAi: { apiKey: GEMINI_PLATFORM_API_KEY, model: AI_PLATFORM_MODEL },
        appBaseUrl: appBaseUrl(),
        productName: PRODUCT_NAME,
        enqueue: async (queue, data, options) => {
          await boss.send(queue, data as object, options ?? {});
        },
      },
      job!.data.commentId,
    );
  });
  await boss.createQueue(QUEUES.engineTick);
  await boss.schedule(QUEUES.engineTick, "* * * * *");
  await boss.work(QUEUES.engineTick, async () => {
    await queueDomainChecks(domainDeps(boss));
    const deps = engineDeps(boss);
    if (deps) await engineTick(deps);
  });
  // Custom link domains (Phase 5): DNS and Cloudflare checks.
  await boss.work<DomainJob>(QUEUES.domainCheck, async ([job]) => checkDomain(domainDeps(boss), job!.data.domainId));
  await boss.work<DomainJob>(QUEUES.domainRemove, async ([job]) => removeDomainHostname(domainDeps(boss), job!.data.domainId));
  // 30-day rule (Q-17 c), daily at 10:30 UTC.
  await boss.createQueue(QUEUES.retention);
  await boss.schedule(QUEUES.retention, "30 10 * * *");
  await boss.work(QUEUES.retention, async () => {
    const deps = engineDeps(boss);
    if (deps) await runRetention(deps);
  });
  await boss.createQueue(QUEUES.websubRenew);
  await boss.schedule(QUEUES.websubRenew, "17 * * * *");
  await boss.work(QUEUES.websubRenew, async () => {
    const deps = engineDeps(boss);
    const secret = env().WEBSUB_SECRET;
    const callbackBase = appBaseUrl();
    // The hub must reach the callback over the public internet.
    if (!deps || !secret || !callbackBase.startsWith("https://")) return;
    await renewWebsub(deps, { secret, callbackBase });
  });
}
