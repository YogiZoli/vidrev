import { eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { customDomains, users } from "@/db/schema";
import { domainCheckPlan } from "@/lib/domains";
import { cookieDomain } from "@/lib/links";
import { log } from "@/lib/log";
import {
  type CloudflareConfig,
  CloudflareError,
  createCustomHostname,
  type CustomHostname,
  deleteCustomHostname,
  findCustomHostname,
  getCustomHostname,
  isLive,
} from "@/server/domains/cloudflare";
import { detectProvider, lookupCname, lookupNs } from "@/server/domains/dns";
import { type DomainConnectConfig, discoverDomainConnect } from "@/server/domains/domain-connect";
import type { FetchLike } from "@/server/google/oauth";
import type { Enqueue } from "./polling";

export interface DomainDeps {
  db: Db;
  fetch: FetchLike;
  cloudflare: CloudflareConfig | null;
  cnameTarget: string | null;
  domainConnect: DomainConnectConfig | null;
  appBaseUrl: string;
  enqueue: Enqueue;
  now?: () => Date;
}

// Queues due checks; runs every minute from the engine tick. Attempts that
// saw no working DNS for 14 days are marked failed ("Check now" restarts).
export async function queueDomainChecks(deps: DomainDeps): Promise<void> {
  const now = deps.now?.() ?? new Date();
  const rows = await deps.db.select().from(customDomains).where(inArray(customDomains.status, ["pending", "active"]));
  for (const domain of rows) {
    const plan = domainCheckPlan(domain, now);
    if ("giveUp" in plan) {
      await deps.db
        .update(customDomains)
        .set({ status: "failed", lastError: domain.lastError ?? "The DNS record was not found within 14 days.", updatedAt: now })
        .where(eq(customDomains.id, domain.id));
    } else if (plan.due) {
      await deps.enqueue("domain.check", { domainId: domain.id }, { singletonKey: domain.id });
    }
  }
}

async function ensureHostname(deps: DomainDeps, config: CloudflareConfig, domain: typeof customDomains.$inferSelect): Promise<CustomHostname> {
  if (domain.cloudflareHostnameId) {
    const current = await getCustomHostname(deps.fetch, config, domain.cloudflareHostnameId);
    if (current) return current;
  }
  try {
    return await createCustomHostname(deps.fetch, config, domain.hostname);
  } catch (error) {
    // Already on the zone (a retry after a lost response): adopt it.
    if (error instanceof CloudflareError && error.status === 409) {
      const existing = await findCustomHostname(deps.fetch, config, domain.hostname);
      if (existing) return existing;
    }
    throw error;
  }
}

// One verification pass (D-38 automatic verification): our own CNAME check,
// DNS provider detection, then the Cloudflare hostname and certificate. The
// domain is live only when Cloudflare says both are active.
export async function checkDomain(deps: DomainDeps, domainId: string): Promise<void> {
  const now = deps.now?.() ?? new Date();
  const [domain] = await deps.db.select().from(customDomains).where(eq(customDomains.id, domainId));
  if (!domain || domain.status === "removed" || domain.status === "failed") return;

  const target = deps.cnameTarget?.toLowerCase() ?? null;
  const cnames = await lookupCname(deps.fetch, domain.hostname).catch((): string[] => []);
  const dnsOk = target !== null && cnames.includes(target);
  const update: Partial<typeof customDomains.$inferInsert> = {
    dnsOk,
    dnsTarget: cnames[0] ?? null,
    checks: domain.checks + 1,
    lastCheckedAt: now,
    updatedAt: now,
  };
  if (!domain.dnsProvider) {
    const registrable = cookieDomain(domain.hostname);
    const nameservers = registrable ? await lookupNs(deps.fetch, registrable).catch((): string[] => []) : [];
    update.nameservers = nameservers;
    update.dnsProvider = detectProvider(nameservers)?.id ?? (nameservers.length > 0 ? "other" : null);
    if (registrable && deps.domainConnect) {
      const support = await discoverDomainConnect(deps.fetch, registrable, deps.domainConnect).catch(() => null);
      update.domainConnect = support ? { providerId: support.providerId, urlSyncUX: support.urlSyncUX } : null;
    }
  }

  if (!deps.cloudflare || !target) {
    update.lastError = "Custom domains are not configured on the server yet.";
    await deps.db.update(customDomains).set(update).where(eq(customDomains.id, domain.id));
    return;
  }

  const hostname = await ensureHostname(deps, deps.cloudflare, domain);
  const live = isLive(hostname);
  Object.assign(update, {
    cloudflareHostnameId: hostname.id,
    hostnameStatus: hostname.status,
    sslStatus: hostname.sslStatus,
    lastError: live ? null : dnsOk ? (hostname.errors[0] ?? null) : cnames.length > 0 ? `The record points to ${cnames[0]}, not ${target}.` : null,
    // A broken live domain drops back to pending so new links use the
    // fallback host until it works again; posted links keep their host.
    status: live ? "active" : "pending",
    ...(live && !domain.verifiedAt ? { verifiedAt: now } : {}),
    ...(!live && domain.status === "active" ? { checkStartedAt: now } : {}),
  });
  await deps.db.update(customDomains).set(update).where(eq(customDomains.id, domain.id));

  if (live && domain.status !== "active") {
    log("info", "custom domain live", { domainId: domain.id });
    const [user] = await deps.db.select({ email: users.email }).from(users).where(eq(users.accountId, domain.accountId));
    if (user) {
      const text = `Your link domain ${domain.hostname} is live. New replies now carry links on your own domain.\n\n${deps.appBaseUrl}/app/settings/domain`;
      await deps.enqueue("email.send", { to: user.email, subject: `${domain.hostname} is live`, text, html: `<p>${text.replace(/\n/g, "<br>")}</p>` });
    }
  } else if (!live && domain.status === "active") {
    log("warn", "custom domain stopped working", { domainId: domain.id, status: hostname.status, ssl: hostname.sslStatus });
  }
}

export async function removeDomainHostname(deps: DomainDeps, domainId: string): Promise<void> {
  const [domain] = await deps.db.select().from(customDomains).where(eq(customDomains.id, domainId));
  if (!domain || domain.status !== "removed" || !domain.cloudflareHostnameId || !deps.cloudflare) return;
  await deleteCustomHostname(deps.fetch, deps.cloudflare, domain.cloudflareHostnameId);
  await deps.db.update(customDomains).set({ cloudflareHostnameId: null, hostnameStatus: "deleted", updatedAt: new Date() }).where(eq(customDomains.id, domain.id));
}
