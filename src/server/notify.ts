import type { Db } from "@/db/client";
import { enqueue } from "@/jobs/enqueue";
import { QUEUES } from "@/jobs/queues";
import { parseEmailList } from "@/lib/email";
import { appBaseUrl, env } from "@/lib/env";
import { log } from "@/lib/log";
import { issueMagicLink } from "@/server/auth/tokens";
import { magicLinkEmail, ownerAlertEmail, passwordResetEmail } from "@/server/email/templates";

export function magicLinkUrl(token: string): string {
  return `${appBaseUrl()}/auth/verify?token=${encodeURIComponent(token)}`;
}

// Issues a magic link and queues the email. Returns false when the per-user
// rate limit is hit; callers never tell the visitor either way.
export async function sendLoginLink(db: Db, target: { userId: string; email: string; welcome: boolean }): Promise<boolean> {
  const token = await issueMagicLink(db, target.userId);
  if (!token) {
    log("warn", "magic link rate limited", { userId: target.userId });
    return false;
  }
  await enqueue(
    QUEUES.sendEmail,
    magicLinkEmail({ to: target.email, url: magicLinkUrl(token), productName: env().PRODUCT_NAME, welcome: target.welcome }),
  );
  return true;
}

// Password reset rides on the one-time sign-in tokens (15 minutes, rate limited).
export async function sendPasswordReset(db: Db, target: { userId: string; email: string }): Promise<boolean> {
  const token = await issueMagicLink(db, target.userId);
  if (!token) {
    log("warn", "password reset rate limited", { userId: target.userId });
    return false;
  }
  const url = `${appBaseUrl()}/auth/reset?token=${encodeURIComponent(token)}`;
  await enqueue(QUEUES.sendEmail, passwordResetEmail({ to: target.email, url, productName: env().PRODUCT_NAME }));
  return true;
}

export async function alertOwners(alerts: { subject: string; lines: string[] }[]): Promise<void> {
  const recipients = parseEmailList(env().ADMIN_EMAILS);
  for (const alert of alerts) {
    log("warn", "owner alert", { subject: alert.subject });
    for (const to of recipients) {
      await enqueue(QUEUES.sendEmail, ownerAlertEmail({ to, productName: env().PRODUCT_NAME, ...alert }));
    }
  }
}
