import type { SendEmailJob } from "@/jobs/queues";
import { errorFields, log } from "@/lib/log";
import { ownerAlertEmail } from "@/server/email/templates";

// Owner alerts from the worker: every alert is logged at once; an email goes
// to ADMIN_EMAILS at most once an hour per problem, and the next one says how
// often it happened in between. Held in memory: one worker instance, and a
// restart at worst sends one email early.
export const ALERT_THROTTLE_MS = 60 * 60_000;

export interface Alerter {
  alert(key: string, subject: string, lines: string[]): Promise<void>;
}

export function createAlerter(opts: {
  send: (job: SendEmailJob) => Promise<void>;
  recipients: string[];
  productName: string;
  now?: () => Date;
  throttleMs?: number;
}): Alerter {
  const lastSent = new Map<string, number>();
  const suppressed = new Map<string, number>();
  const throttle = opts.throttleMs ?? ALERT_THROTTLE_MS;
  return {
    async alert(key, subject, lines) {
      const now = (opts.now?.() ?? new Date()).getTime();
      log("error", "owner alert", { key, subject, detail: lines.join(" | ") });
      const last = lastSent.get(key);
      if (last !== undefined && now - last < throttle) {
        suppressed.set(key, (suppressed.get(key) ?? 0) + 1);
        return;
      }
      const repeats = suppressed.get(key) ?? 0;
      lastSent.set(key, now);
      suppressed.delete(key);
      const body = repeats > 0 ? [...lines, "", `It also happened ${repeats} more time(s) since the last email.`] : lines;
      if (opts.recipients.length === 0) {
        log("warn", "owner alert not emailed: ADMIN_EMAILS is empty", { key });
        return;
      }
      for (const to of opts.recipients) {
        try {
          await opts.send(ownerAlertEmail({ to, subject, lines: body, productName: opts.productName }));
        } catch (error) {
          log("error", "owner alert email could not be queued", { key, ...errorFields(error) });
        }
      }
    },
  };
}

// Groups the same problem under one key: ids, numbers and quoted values in a
// message change per occurrence, the problem does not.
export function problemKey(prefix: string, message: string): string {
  const normalized = message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
    .replace(/"[^"]*"/g, '"<v>"')
    .replace(/\d+/g, "<n>")
    .slice(0, 120);
  return `${prefix}:${normalized}`;
}
