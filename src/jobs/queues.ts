// Queue names and payloads shared by web (producer) and worker (consumer).
// All external calls (Resend, Google APIs) run in the worker (SPEC section 1).
export const QUEUES = {
  heartbeat: "system.heartbeat",
  sendEmail: "email.send",
  channelSync: "channel.sync",
  channelDisconnect: "channel.disconnect",
  engineTick: "engine.tick",
  websubRenew: "websub.renew",
  retention: "retention.daily",
  channelPoll: "channel.poll",
  channelRss: "channel.rss",
  replyDraft: "reply.draft",
  replySend: "reply.send",
  domainCheck: "domain.check",
  domainRemove: "domain.remove",
  webhookDeliver: "webhook.deliver",
} as const;

export interface SendEmailJob {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface ChannelJob {
  channelId: string;
}

export interface CommentJob {
  commentId: string;
}

export interface ReplyJob {
  replyId: string;
}

export interface DomainJob {
  domainId: string;
}

export interface DeliveryJob {
  deliveryId: string;
}

export interface JobPayloads {
  [QUEUES.sendEmail]: SendEmailJob;
  [QUEUES.channelSync]: ChannelJob;
  [QUEUES.channelDisconnect]: ChannelJob;
  [QUEUES.channelPoll]: ChannelJob;
  [QUEUES.channelRss]: ChannelJob;
  [QUEUES.replyDraft]: CommentJob;
  [QUEUES.replySend]: ReplyJob;
  [QUEUES.domainCheck]: DomainJob;
  [QUEUES.domainRemove]: DomainJob;
  [QUEUES.webhookDeliver]: DeliveryJob;
}

// Email jobs carry magic links, so they are removed soon after completion.
export const QUEUE_OPTIONS = {
  [QUEUES.sendEmail]: { retryLimit: 5, retryDelay: 30, retryBackoff: true, deleteAfterSeconds: 3600 },
  [QUEUES.channelSync]: { retryLimit: 5, retryDelay: 30, retryBackoff: true },
  [QUEUES.channelDisconnect]: { retryLimit: 10, retryDelay: 60, retryBackoff: true },
  // One queued plus one running job per channel (singletonKey = channel id).
  [QUEUES.channelPoll]: { policy: "stately", retryLimit: 2, retryDelay: 30, expireInSeconds: 300 },
  [QUEUES.channelRss]: { policy: "stately", retryLimit: 2, retryDelay: 60 },
  [QUEUES.replyDraft]: { retryLimit: 5, retryDelay: 30, retryBackoff: true },
  [QUEUES.replySend]: { policy: "stately", retryLimit: 5, retryDelay: 60, retryBackoff: true },
  [QUEUES.domainCheck]: { policy: "stately", retryLimit: 2, retryDelay: 30 },
  [QUEUES.domainRemove]: { retryLimit: 10, retryDelay: 60, retryBackoff: true },
  // The outbox row carries the retry state (24 hours of backoff), so the job
  // itself is never retried: a lost job is picked up by the engine tick.
  [QUEUES.webhookDeliver]: { policy: "stately", retryLimit: 0, expireInSeconds: 60 },
} as const;
