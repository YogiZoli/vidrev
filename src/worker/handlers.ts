import type { PgBoss } from "pg-boss";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { type AccountJob, type AuditJob, type ChannelJob, type CommentJob, type DeliveryJob, type DomainJob, type GhlEventJob, type GhlIntegrationJob, type GhlNoteJob, type ReplyJob, QUEUES, QUEUE_OPTIONS, type SendEmailJob } from "@/jobs/queues";
import { ghlReconnectEmail, stripeReconnectEmail } from "@/server/email/templates";
import { postJson } from "@/server/integrations/http-post";
import { pruneDeliveries } from "@/server/integrations/outbound";
import { appBaseUrl, domainConnectConfig, env } from "@/lib/env";
import { errorFields, log } from "@/lib/log";
import { type ChannelDeps, disconnectChannel, expireStuckConnects, syncChannel } from "./channels";
import { EmailSendError, senderAddress, sendWithResend } from "./email";
import { createDraft } from "./drafts";
import { checkDomain, type DomainDeps, queueDomainChecks, removeDomainHostname } from "./domains";
import { runRetention } from "./retention";
import { recoverUnconfirmedSends, sendReply } from "./sending";
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

function ghlDeps(boss: PgBoss): GhlWorkerDeps | null {
  const { ENCRYPTION_KEY, GHL_CLIENT_ID, GHL_CLIENT_SECRET, PRODUCT_NAME } = env();
  if (!ENCRYPTION_KEY) return null;
  const db = getDb();
  return {
    db,
    fetch,
    encryptionKey: ENCRYPTION_KEY,
    client: GHL_CLIENT_ID && GHL_CLIENT_SECRET ? { clientId: GHL_CLIENT_ID, clientSecret: GHL_CLIENT_SECRET } : null,
    enqueue: async (queue, data, options) => {
      await boss.send(queue, data as object, options ?? {});
    },
    // The connection was refused: tell the creator once to reconnect.
    onReauth: async (accountId) => {
      const recipients = await db.select({ email: users.email }).from(users).where(eq(users.accountId, accountId));
      for (const { email } of recipients) {
        await boss.send(QUEUES.sendEmail, ghlReconnectEmail({ to: email, url: `${appBaseUrl()}/app/settings/gohighlevel`, productName: PRODUCT_NAME }) as object, {});
      }
    },
  };
}

function stripeDeps(boss: PgBoss): StripeWorkerDeps | null {
  const { ENCRYPTION_KEY, PRODUCT_NAME } = env();
  if (!ENCRYPTION_KEY) return null;
  const db = getDb();
  return {
    db,
    fetch,
    encryptionKey: ENCRYPTION_KEY,
    enqueue: async (queue, data, options) => {
      await boss.send(queue, data as object, options ?? {});
    },
    // Stripe refused the key: tell the creator once to reconnect.
    onKeyRejected: async (accountId) => {
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
    enqueue: async (queue, data, options) => {
      await boss.send(queue, data as object, options ?? {});
    },
  };
}

function auditDeps(): AuditDeps {
  return {
    db: getDb(),
    fetch,
    apiKey: env().YT_API_KEY_AUDIT ?? null,
    dailyLimit: env().AUDIT_DAILY_LIMIT,
    fetchPage,
    resolveCname: (host) => dnsPromises.resolveCname(host).then((names) => names.map((n) => n.toLowerCase())),
  };
}

function webhookDeps(boss: PgBoss): WebhookDeps | null {
  const { ENCRYPTION_KEY } = env();
  return ENCRYPTION_KEY ? { db: getDb(), encryptionKey: ENCRYPTION_KEY, post: postJson, ghl: ghlDeps(boss) } : null;
}

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
    domainConnect: domainConnectConfig(),
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
    const hooks = webhookDeps(boss);
    if (hooks) await deliverDue(hooks);
    const ghl = ghlDeps(boss);
    if (ghl) await queueGhlWork(ghl);
    const stripe = stripeDeps(boss);
    if (stripe) await queueStripeWork(stripe);
    await queueReportRefreshes(reportDeps(boss));
    await failStuckAudits(getDb(), new Date());
    const deps = engineDeps(boss);
    if (deps) await engineTick(deps);
    // Recovery of stuck states, each on its own so one failure never blocks the other.
    if (deps) await recoverUnconfirmedSends(deps).catch((error: unknown) => log("error", "send recovery failed", errorFields(error)));
    const channels = channelDeps();
    if (channels) await expireStuckConnects(channels).catch((error: unknown) => log("error", "connect timeout sweep failed", errorFields(error)));
  });
  // Audit my channel (Phase 9): one run per request, own API key and quota.
  await boss.work<AuditJob>(QUEUES.auditRun, async ([job]) => runAudit(auditDeps(), job!.data.auditId));
  // Audit leads into the owner's own GoHighLevel Sub-account.
  await boss.work<AuditJob>(QUEUES.auditLead, async ([job]) => {
    const { OWNER_GHL_API_KEY, OWNER_GHL_LOCATION_ID } = env();
    const crm = OWNER_GHL_API_KEY && OWNER_GHL_LOCATION_ID ? { apiKey: OWNER_GHL_API_KEY, locationId: OWNER_GHL_LOCATION_ID } : null;
    const outcome = await pushAuditLead({ db: getDb(), fetch, crm }, job!.data.auditId);
    log("info", "audit lead", { auditId: job!.data.auditId, outcome });
  });
  // Outbound webhooks (Phase 6): immediate delivery; the tick covers retries.
  await boss.work<DeliveryJob>(QUEUES.webhookDeliver, async ([job]) => {
    const hooks = webhookDeps(boss);
    if (hooks) await deliver(hooks, job!.data.deliveryId);
  });
  // GoHighLevel (Phase 6): one-time setup, the 5 minute sync, marketplace webhooks.
  await boss.work<GhlIntegrationJob>(QUEUES.ghlSetup, async ([job]) => {
    const deps = ghlDeps(boss);
    if (deps) await setupGhl(deps, job!.data.integrationId);
  });
  await boss.work<GhlIntegrationJob>(QUEUES.ghlSync, async ([job]) => {
    const deps = ghlDeps(boss);
    if (deps) await syncGhl(deps, job!.data.integrationId);
  });
  // Stripe (Phase 8): the read-only sync with the creator's restricted key.
  await boss.work<GhlIntegrationJob>(QUEUES.stripeSync, async ([job]) => {
    const deps = stripeDeps(boss);
    if (deps) await syncStripe(deps, job!.data.integrationId);
  });
  await boss.work<GhlEventJob>(QUEUES.ghlEvent, async ([job]) => {
    const deps = ghlDeps(boss);
    if (deps) await handleGhlEvent(deps, job!.data.integrationId, job!.data.payload);
  });
  await boss.work<GhlNoteJob>(QUEUES.ghlNote, async ([job]) => {
    const deps = ghlDeps(boss);
    if (deps) await addContactNote(deps, job!.data.integrationId, job!.data.ghlContactId, job!.data.text);
  });
  // Attribution and reports (Phase 7): refresh per dirty account; hourly,
  // every account is marked so periods roll over.
  await boss.work<AccountJob>(QUEUES.reportRefresh, async ([job]) => refreshAccountReports(reportDeps(boss), job!.data.accountId));
  await boss.createQueue(QUEUES.reportHourly);
  await boss.schedule(QUEUES.reportHourly, "7 * * * *");
  await boss.work(QUEUES.reportHourly, async () => {
    await backfillContacts(getDb());
    await markAllReportsDirty(getDb());
  });
  // Contacts for rows older than the Contact model (DECISIONS section 13.10):
  // once at start, so a deploy does not wait for the hourly pass.
  void backfillContacts(getDb()).then(
    (done) => log("info", "contacts backfill", { ...done }),
    (error: unknown) => log("error", "contacts backfill failed", errorFields(error)),
  );
  // Custom link domains (Phase 5): DNS and Cloudflare checks.
  await boss.work<DomainJob>(QUEUES.domainCheck, async ([job]) => checkDomain(domainDeps(boss), job!.data.domainId));
  await boss.work<DomainJob>(QUEUES.domainRemove, async ([job]) => removeDomainHostname(domainDeps(boss), job!.data.domainId));
  // 30-day rule (Q-17 c), daily at 10:30 UTC.
  await boss.createQueue(QUEUES.retention);
  await boss.schedule(QUEUES.retention, "30 10 * * *");
  await boss.work(QUEUES.retention, async () => {
    const deps = engineDeps(boss);
    if (deps) await runRetention(deps);
    await pruneDeliveries(getDb());
    await scrubAudits(getDb(), new Date(), API_DATA_TTL_MS);
    await deleteExpiredInstalls(getDb());
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
