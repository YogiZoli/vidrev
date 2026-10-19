import { and, count, eq, ne } from "drizzle-orm";
import type { Db } from "@/db/client";
import { campaigns, customDomains } from "@/db/schema";
import { cookieDomain, hostOf, isApex, normalizeHostname } from "@/lib/links";

// Creator actions on the custom link domain. Every external call (DNS,
// Cloudflare) runs in the worker (D-36); these only touch the database.

export type DomainResult = { ok: true; id: string } | { ok: false; error: string; capReached?: true };

export async function liveDomain(db: Db, accountId: string) {
  const [row] = await db
    .select()
    .from(customDomains)
    .where(and(eq(customDomains.accountId, accountId), ne(customDomains.status, "removed")));
  return row ?? null;
}

// Registrable domains the product itself uses; creators cannot claim them.
export function reservedDomains(urls: (string | undefined)[]): Set<string> {
  const out = new Set<string>();
  for (const url of urls) {
    if (!url) continue;
    try {
      const domain = cookieDomain(new URL(url).hostname);
      if (domain) out.add(domain);
    } catch {
      // ignore malformed configuration
    }
  }
  return out;
}

export async function addDomain(db: Db, accountId: string, input: string, reserved: Set<string>, limit = Infinity): Promise<DomainResult> {
  const hostname = normalizeHostname(input);
  if (!hostname) return { ok: false, error: "Enter a subdomain such as go.yourdomain.com." };
  if (isApex(hostname)) return { ok: false, error: "Use a subdomain such as go." + hostname + ", not the main domain." };
  if (reserved.has(cookieDomain(hostname) ?? "")) return { ok: false, error: "That domain belongs to this product. Use your own domain." };
  if (await liveDomain(db, accountId)) return { ok: false, error: "Remove your current link domain first." };
  // A subdomain that already serves the creator's pages (an automation
  // destination, e.g. go.<domain> on GoHighLevel) would go down if pointed at us.
  const destinations = await db.select({ url: campaigns.destinationUrl }).from(campaigns).where(eq(campaigns.accountId, accountId));
  if (destinations.some((d) => hostOf(d.url) === hostname)) {
    return { ok: false, error: `${hostname} already serves your pages, so it cannot carry links too. Use a new subdomain such as link.${cookieDomain(hostname) ?? hostname}.` };
  }
  // Spend cap on Cloudflare custom hostnames (P5-11).
  const [{ n }] = await db.select({ n: count() }).from(customDomains).where(ne(customDomains.status, "removed"));
  if (n >= limit) {
    return { ok: false, capReached: true, error: "Own link domains are at capacity right now. Your replies keep working on the default link host; we will email you when a slot opens." };
  }
  const [row] = await db.insert(customDomains).values({ accountId, hostname }).onConflictDoNothing().returning({ id: customDomains.id });
  if (!row) return { ok: false, error: "This domain is already used by another account." };
  return { ok: true, id: row.id };
}

// Marks the domain removed at once (new links use the fallback host); the
// worker then deletes the Cloudflare hostname. Posted links on this host
// stop working once the creator's CNAME is gone (R-07), which the UI states.
export async function removeDomain(db: Db, accountId: string, domainId: string, now = new Date()): Promise<boolean> {
  const rows = await db
    .update(customDomains)
    .set({ status: "removed", removedAt: now, updatedAt: now })
    .where(and(eq(customDomains.id, domainId), eq(customDomains.accountId, accountId), ne(customDomains.status, "removed")))
    .returning({ id: customDomains.id });
  return rows.length > 0;
}

// "Check now": a failed attempt starts over.
export async function restartDomainCheck(db: Db, accountId: string, domainId: string, now = new Date()): Promise<boolean> {
  const rows = await db
    .update(customDomains)
    .set({ lastCheckedAt: null, updatedAt: now })
    .where(and(eq(customDomains.id, domainId), eq(customDomains.accountId, accountId), ne(customDomains.status, "removed")))
    .returning({ id: customDomains.id, status: customDomains.status });
  const [row] = rows;
  if (row?.status === "failed") {
    await db.update(customDomains).set({ status: "pending", checkStartedAt: now, lastError: null }).where(eq(customDomains.id, row.id));
  }
  return rows.length > 0;
}
