import type { JobWithMetadata, PgBoss } from "pg-boss";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { type AccountJob, type AuditJob, type ChannelJob, type CommentJob, type DeliveryJob, type DomainJob, type GhlEventJob, type GhlIntegrationJob, type GhlNoteJob, type ReplyJob, QUEUES, QUEUE_OPTIONS, type SendEmailJob } from "@/jobs/queues";
import { ghlReconnectEmail, stripeReconnectEmail } from "@/server/email/templates";
import { postJson } from "@/server/integrations/http-post";
import { pruneDeliveries } from "@/server/integrations/outbound";
import { parseEmailList } from "@/lib/email";
import { appBaseUrl, domainConnectConfig, env } from "@/lib/env";
import { timedFetch } from "@/lib/http";
import { errorFields, log } from "@/lib/log";
import { type Alerter, createAlerter } from "./alerts";
import { type ChannelDeps, disconnectChannel, expireStuckConnects, syncChannel } from "./channels";
import { EmailSendError, senderAddress, sendWithResend } from "./email";
import { createDraft } from "./drafts";
import { checkDomain, type DomainDeps, queueDomainChecks, removeDomainHostname } from "./domains";
import { runJob, runSteps } from "./jobs";
import { runRetention } from "./retention";
import { recoverUnconfirmedSends, requeueOrphanedApproved, sendReply } from "./sending";
import { checkRss, type EngineDeps, engineTick, pollChannel, renewWebsub } from "./polling";
import { deliver, deliverDue, type WebhookDeps } from "./webhooks";
import { pushAuditLead } from "@/server/audit/owner-crm";
import { deleteExpiredInstalls } from "@/server/ghl/install";
import { addContactNote, type GhlWorkerDeps, handleGhlEvent, queueGhlWork, setupGhl, syncGhl } from "./ghl";
import { queueReportRefreshes, refreshAccountReports, type ReportDeps } from "./reports";
import { queueStripeWork, type StripeWorkerDeps, syncStripe } from "./stripe";
import { markAllReportsDirty } from "@/server/attribution";
import { promises as dnsPromises } from "node:dns";
import { fetchPage } from "@/server/audit/fetch-page";
import { API_DATA_TTL_MS } from "@/server/audit/service";
import { type AuditDeps, failStuckAudits, runAudit, scrubAudits } from "./audit";
import { backfillContacts } from "@/server/contacts-backfill";

// Every outbound call from the worker has a time limit (src/lib/http.ts).
const httpFetch = timedFetch();

// A job that needs a setting which is not there fails loudly (logged, retried,
// then an owner alert) instead of doing nothing without a trace.
export class MissingConfigError extends Error {
  constructor(names: string[]) {
    super(`Missing configuration: ${names.join(", ")}`);
    this.name = "MissingConfigError";
  }
}

function missing(values: Record<string, string | undefined | null>): string[] {
  return Object.entries(values)
    .filter(([, value]) => !value)
    .map(([name]) => name);
}

function sendVia(boss: PgBoss) {
  return async (queue: string, data: unknown, options?: { singletonKey?: string; startAfter?: number }) => {
    await boss.send(queue, data as object, options ?? {});
  };
}

function ghlDeps(boss: PgBoss): GhlWorkerDeps {
  const { ENCRYPTION_KEY, GHL_CLIENT_ID, GHL_CLIENT_SECRET, PRODUCT_NAME } = env();
  if (!ENCRYPTION_KEY) throw new MissingConfigError(["ENCRYPTION_KEY"]);
  const db = getDb();
  return {
    db,
    fetch: httpFetch,
    encryptionKey: ENCRYPTION_KEY,
    client: GHL_CLIENT_ID && GHL_CLIENT_SECRET ? { clientId: GHL_CLIENT_ID, clientSecret: GHL_CLIENT_SECRET } : null,
    enqueue: sendVia(boss),
    // The connection was refused: tell the creator once to reconnect.
    onReauth: async (accountId) => {
      log("warn", "ghl connection needs to be reconnected, creator emailed", { accountId });
      const recipients = await db.select({ email: users.email }).from(users).where(eq(users.accountId, accountId));
      for (const { email } of recipients) {
        await boss.send(QUEUES.sendEmail, ghlReconnectEmail({ to: email, url: `${appBaseUrl()}/app/settings/gohighlevel`, productName: PRODUCT_NAME }) as object, {});
      }
    },
  };
}

function stripeDeps(boss: PgBoss): StripeWorkerDeps {
  const { ENCRYPTION_KEY, PRODUCT_NAME } = env();
  if (!ENCRYPTION_KEY) throw new MissingConfigError(["ENCRYPTION_KEY"]);
  const db = getDb();
  return {
    db,
    fetch: httpFetch,
    encryptionKey: ENCRYPTION_KEY,
    enqueue: sendVia(boss),
    // Stripe refused the key: tell the creator once to reconnect.
    onKeyRejected: async (accountId) => {
      log("warn", "stripe key rejected, creator emailed", { accountId });
      const recipients = await db.select({ email: users.email }).from(users).where(eq(users.accountId, accountId));
      for (const { email } of recipients) {
        await boss.send(QUEUES.sendEmail, stripeReconnectEmail({ to: email, url: `${appBaseUrl()}/app/settings/stripe`, productName: PRODUCT_NAME }) as object, {});
      }
    },
  };
}

function reportDeps(boss: PgBoss): ReportDeps {
  return {
    db: getDb(),
    notify: {
      appBaseUrl: appBaseUrl(),
      productName: env().PRODUCT_NAME,
      sendEmail: async (job) => {
        await boss.send(QUEUES.sendEmail, job as object, {});
      },
    },
    enqueue: sendVia(boss),
  };
}

function auditDeps(): AuditDeps {
  return {
    db: getDb(),
    fetch: httpFetch,
    apiKey: env().YT_API_KEY_AUDIT ?? null,
    dailyLimit: env().AUDIT_DAILY_LIMIT,
    fetchPage,
    resolveCname: (host) => dnsPromises.resolveCname(host).then((names) => names.map((n) => n.toLowerCase())),
  };
}

function webhookDeps(boss: PgBoss): WebhookDeps {
  const { ENCRYPTION_KEY } = env();
  if (!ENCRYPTION_KEY) throw new MissingConfigError(["ENCRYPTION_KEY"]);
  return { db: getDb(), encryptionKey: ENCRYPTION_KEY, post: postJson, ghl: ghlDeps(boss) };
}

async function sendEmail(job: SendEmailJob): Promise<void> {
  const { RESEND_API_KEY, EMAIL_FROM, PRODUCT_NAME, NODE_ENV } = env();
  if (!RESEND_API_KEY) {
    if (NODE_ENV !== "production") {
      // Local development without Resend: print the email so magic links work.
      log("info", "email (not sent, no RESEND_API_KEY)", { to: job.to, subject: job.subject, text: job.text });
      return;
    }
    throw new MissingConfigError(["RESEND_API_KEY"]);
  }
  try {
    const id = await sendWithResend(job, { apiKey: RESEND_API_KEY, from: senderAddress(EMAIL_FROM, PRODUCT_NAME) }, httpFetch);
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

function channelDeps(): ChannelDeps {
  const { ENCRYPTION_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = env();
  const absent = missing({ ENCRYPTION_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET });
  if (absent.length > 0) throw new MissingConfigError(absent);
  return {
    db: getDb(),
    fetch: httpFetch,
    encryptionKey: ENCRYPTION_KEY!,
    google: { clientId: GOOGLE_CLIENT_ID!, clientSecret: GOOGLE_CLIENT_SECRET! },
  };
}

function engineDeps(boss: PgBoss): EngineDeps {
  return { ...channelDeps(), quotaLimit: env().QUOTA_DAILY_LIMIT, enqueue: sendVia(boss) };
}

function domainDeps(boss: PgBoss): DomainDeps {
  const { CLOUDFLARE_API_TOKEN, CLOUDFLARE_ZONE_ID, CUSTOM_HOSTNAME_CNAME_TARGET } = env();
  return {
    db: getDb(),
    fetch: httpFetch,
    cloudflare: CLOUDFLARE_API_TOKEN && CLOUDFLARE_ZONE_ID ? { apiToken: CLOUDFLARE_API_TOKEN, zoneId: CLOUDFLARE_ZONE_ID } : null,
    cnameTarget: CUSTOM_HOSTNAME_CNAME_TARGET ?? null,
    domainConnect: domainConnectConfig(),
    appBaseUrl: appBaseUrl(),
    enqueue: sendVia(boss),
  };
}

function ownerAlerter(boss: PgBoss): Alerter {
  return createAlerter({
    send: async (job) => {
      await boss.send(QUEUES.sendEmail, job as object, {});
    },
    recipients: parseEmailList(env().ADMIN_EMAILS),
    productName: env().PRODUCT_NAME,
  });
}

export async function registerHandlers(boss: PgBoss): Promise<void> {
  for (const [name, options] of Object.entries(QUEUE_OPTIONS)) {
    await boss.createQueue(name, options);
  }
  const alerter = ownerAlerter(boss);
  // Every queue runs through runJob: failures logged with queue, job id,
  // attempt and stack; the last failed attempt alerts the owner.
  const work = <T>(queue: string, handler: (job: JobWithMetadata<T>) => Promise<void>) =>
    boss.work<T, void, { includeMetadata: true }>(queue, { includeMetadata: true }, runJob<T>(queue, alerter, handler));
  // Scheduled jobs made of independent steps: one failing step never stops the others.
  const schedule = async (queue: string, cron: string, steps: () => [string, () => Promise<unknown>][]) => {
    await boss.createQueue(queue);
    await boss.schedule(queue, cron);
    await boss.work(queue, async () => {
      await runSteps(queue, alerter, steps());
    });
  };

  await work<SendEmailJob>(QUEUES.sendEmail, (job) => sendEmail(job.data));
  await work<ChannelJob>(QUEUES.channelSync, (job) => syncChannel(channelDeps(), job.data.channelId));
  await work<ChannelJob>(QUEUES.channelDisconnect, (job) => disconnectChannel(channelDeps(), job.data.channelId));

  // Comment engine (SPEC section 7). The tick queues due polls and RSS
  // checks every minute; push leases are renewed hourly.
  await work<ChannelJob>(QUEUES.channelPoll, (job) => pollChannel(engineDeps(boss), job.data.channelId));
  await work<ReplyJob>(QUEUES.replySend, (job) => sendReply(engineDeps(boss), job.data.replyId));
  await work<ChannelJob>(QUEUES.channelRss, (job) => checkRss(engineDeps(boss), job.data.channelId));
  await work<CommentJob>(QUEUES.replyDraft, async (job) => {
    const { ENCRYPTION_KEY, GEMINI_PLATFORM_API_KEY, AI_PLATFORM_MODEL, PRODUCT_NAME } = env();
    await createDraft(
      {
        db: getDb(),
        fetch: httpFetch,
        encryptionKey: ENCRYPTION_KEY,
        platformAi: { apiKey: GEMINI_PLATFORM_API_KEY, model: AI_PLATFORM_MODEL },
        appBaseUrl: appBaseUrl(),
        productName: PRODUCT_NAME,
        enqueue: sendVia(boss),
      },
      job.data.commentId,
    );
  });
  await schedule(QUEUES.engineTick, "* * * * *", () => [
    ["domain checks", () => queueDomainChecks(domainDeps(boss))],
    ["webhook retries", () => deliverDue(webhookDeps(boss))],
    ["gohighlevel syncs", () => queueGhlWork(ghlDeps(boss))],
    ["stripe syncs", () => queueStripeWork(stripeDeps(boss))],
    ["report refreshes", () => queueReportRefreshes(reportDeps(boss))],
    ["stuck audits", () => failStuckAudits(getDb(), new Date())],
    ["polling", () => engineTick(engineDeps(boss))],
    // Recovery of stuck states (reliability review 2026-09-29).
    ["unconfirmed sends", () => recoverUnconfirmedSends(engineDeps(boss))],
    ["orphaned approved replies", () => requeueOrphanedApproved(engineDeps(boss))],
    ["stuck channel connects", () => expireStuckConnects(channelDeps())],
  ]);
  // Audit my channel (Phase 9): one run per request, own API key and quota.
  await work<AuditJob>(QUEUES.auditRun, (job) => runAudit(auditDeps(), job.data.auditId));
  // Audit leads into the owner's own GoHighLevel Sub-account.
  await work<AuditJob>(QUEUES.auditLead, async (job) => {
    const { OWNER_GHL_API_KEY, OWNER_GHL_LOCATION_ID } = env();
    const crm = OWNER_GHL_API_KEY && OWNER_GHL_LOCATION_ID ? { apiKey: OWNER_GHL_API_KEY, locationId: OWNER_GHL_LOCATION_ID } : null;
    const outcome = await pushAuditLead({ db: getDb(), fetch: httpFetch, crm }, job.data.auditId);
    log("info", "audit lead", { auditId: job.data.auditId, outcome });
  });
  // Outbound webhooks (Phase 6): immediate delivery; the tick covers retries.
  await work<DeliveryJob>(QUEUES.webhookDeliver, (job) => deliver(webhookDeps(boss), job.data.deliveryId));
  // GoHighLevel (Phase 6): one-time setup, the 5 minute sync, marketplace webhooks.
  await work<GhlIntegrationJob>(QUEUES.ghlSetup, (job) => setupGhl(ghlDeps(boss), job.data.integrationId));
  await work<GhlIntegrationJob>(QUEUES.ghlSync, (job) => syncGhl(ghlDeps(boss), job.data.integrationId));
  // Stripe (Phase 8): the read-only sync with the creator's restricted key.
  await work<GhlIntegrationJob>(QUEUES.stripeSync, (job) => syncStripe(stripeDeps(boss), job.data.integrationId));
  await work<GhlEventJob>(QUEUES.ghlEvent, (job) => handleGhlEvent(ghlDeps(boss), job.data.integrationId, job.data.payload));
  await work<GhlNoteJob>(QUEUES.ghlNote, (job) => addContactNote(ghlDeps(boss), job.data.integrationId, job.data.ghlContactId, job.data.text));
  // Attribution and reports (Phase 7): refresh per dirty account; hourly,
  // every account is marked so periods roll over.
  await work<AccountJob>(QUEUES.reportRefresh, (job) => refreshAccountReports(reportDeps(boss), job.data.accountId));
  await schedule(QUEUES.reportHourly, "7 * * * *", () => [
    ["contacts backfill", () => backfillContacts(getDb())],
    ["mark reports dirty", () => markAllReportsDirty(getDb())],
  ]);
  // Contacts for rows older than the Contact model (DECISIONS section 13.10):
  // once at start, so a deploy does not wait for the hourly pass.
  void runSteps("worker start", alerter, [
    [
      "contacts backfill",
      async () => {
        const done = await backfillContacts(getDb());
        log("info", "contacts backfill", { ...done });
      },
    ],
  ]);
  // Custom link domains (Phase 5): DNS and Cloudflare checks.
  await work<DomainJob>(QUEUES.domainCheck, (job) => checkDomain(domainDeps(boss), job.data.domainId));
  await work<DomainJob>(QUEUES.domainRemove, (job) => removeDomainHostname(domainDeps(boss), job.data.domainId));
  // 30-day rule (Q-17 c), daily at 10:30 UTC.
  await schedule(QUEUES.retention, "30 10 * * *", () => [
    ["youtube data", () => runRetention(engineDeps(boss))],
    ["delivery logs", () => pruneDeliveries(getDb())],
    ["audit data", () => scrubAudits(getDb(), new Date(), API_DATA_TTL_MS)],
    ["expired gohighlevel installs", () => deleteExpiredInstalls(getDb())],
  ]);
  await schedule(QUEUES.websubRenew, "17 * * * *", () => [
    [
      "websub leases",
      async () => {
        const secret = env().WEBSUB_SECRET;
        const callbackBase = appBaseUrl();
        // Push is optional (RSS covers it, DECISIONS section 8); say so once an hour.
        if (!secret || !callbackBase.startsWith("https://")) {
          log("info", "websub renewal skipped", { reason: !secret ? "WEBSUB_SECRET not set" : "app base url is not https" });
          return;
        }
        await renewWebsub(engineDeps(boss), { secret, callbackBase });
      },
    ],
  ]);
}
