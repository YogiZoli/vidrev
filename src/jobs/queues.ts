// Queue names and payloads shared by web (producer) and worker (consumer).
// All external calls (Resend, Google APIs) run in the worker (SPEC section 1).
export const QUEUES = {
  heartbeat: "system.heartbeat",
  sendEmail: "email.send",
  channelSync: "channel.sync",
  channelDisconnect: "channel.disconnect",
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

export interface JobPayloads {
  [QUEUES.sendEmail]: SendEmailJob;
  [QUEUES.channelSync]: ChannelJob;
  [QUEUES.channelDisconnect]: ChannelJob;
}

// Email jobs carry magic links, so they are removed soon after completion.
export const QUEUE_OPTIONS = {
  [QUEUES.sendEmail]: { retryLimit: 5, retryDelay: 30, retryBackoff: true, deleteAfterSeconds: 3600 },
  [QUEUES.channelSync]: { retryLimit: 5, retryDelay: 30, retryBackoff: true },
  [QUEUES.channelDisconnect]: { retryLimit: 10, retryDelay: 60, retryBackoff: true },
} as const;
