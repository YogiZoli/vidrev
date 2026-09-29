import { and, eq, isNotNull, ne } from "drizzle-orm";
import type { Db } from "@/db/client";
import { accounts, campaigns, customDomains } from "@/db/schema";
import { appHost, fallbackHost } from "@/lib/link-host";
import { log } from "@/lib/log";

// A reply destination may never be on our own hosts: the app, the fallback
// link host or the creator's tracked-link domain. C2C shipped such a link
// twice (the "apex artifact": our host plus a GoHighLevel page path), and
// every click was a 404, so the lead was lost.

export function isOwnHost(url: string, hosts: readonly string[]): boolean {
  try {
    return hosts.includes(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

export async function ownHosts(db: Db, accountId: string | null): Promise<string[]> {
  const hosts = [appHost(), fallbackHost()].filter((h): h is string => Boolean(h));
  if (!accountId) return hosts;
  const domains = await db
    .select({ hostname: customDomains.hostname })
    .from(customDomains)
    .where(and(eq(customDomains.accountId, accountId), ne(customDomains.status, "removed")));
  return [...hosts, ...domains.map((d) => d.hostname.toLowerCase())];
}

export const OWN_HOST_ERROR = "This address is on vidrev's own link or app domain, so viewers would land on an error page. Pick your opt-in page instead.";

// Once at worker start: destinations saved before the guard existed. Only
// logged (the owner fixes them with the creator); nothing is changed.
export async function findOwnHostDestinations(db: Db): Promise<number> {
  const rows = await db.select({ id: campaigns.id, accountId: campaigns.accountId, url: campaigns.destinationUrl }).from(campaigns);
  const defaults = await db.select({ accountId: accounts.id, url: accounts.defaultTargetUrl }).from(accounts).where(isNotNull(accounts.defaultTargetUrl));
  let found = 0;
  const hostsByAccount = new Map<string, string[]>();
  const hostsFor = async (accountId: string) => {
    if (!hostsByAccount.has(accountId)) hostsByAccount.set(accountId, await ownHosts(db, accountId));
    return hostsByAccount.get(accountId)!;
  };
  for (const row of rows) {
    if (!isOwnHost(row.url, await hostsFor(row.accountId))) continue;
    found += 1;
    log("error", "automation destination is on our own host", { campaignId: row.id, accountId: row.accountId, host: new URL(row.url).hostname });
  }
  for (const row of defaults) {
    if (!row.url || !isOwnHost(row.url, await hostsFor(row.accountId))) continue;
    found += 1;
    log("error", "default target url is on our own host", { accountId: row.accountId, host: new URL(row.url).hostname });
  }
  log("info", "own host destination check", { found });
  return found;
}
