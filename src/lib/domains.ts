// Check rhythm for custom link domains (D-38: automatic verification). The
// creator usually adds the CNAME within minutes, so the first quarter hour is
// checked every minute; after 14 days without DNS the attempt is given up.

const MINUTE = 60_000;

export type DomainCheckPlan = { due: boolean } | { giveUp: true };

export function domainCheckPlan(
  domain: { status: string; checkStartedAt: Date; lastCheckedAt: Date | null },
  now: Date,
): DomainCheckPlan {
  if (domain.status === "removed" || domain.status === "failed") return { due: false };
  const since = (at: Date | null) => (at ? now.getTime() - at.getTime() : Infinity);
  if (domain.status === "active") return { due: since(domain.lastCheckedAt) >= 24 * 60 * MINUTE };
  const age = now.getTime() - domain.checkStartedAt.getTime();
  if (age > 14 * 24 * 60 * MINUTE) return { giveUp: true };
  const every = age < 15 * MINUTE ? MINUTE : age < 48 * 60 * MINUTE ? 10 * MINUTE : 60 * MINUTE;
  return { due: since(domain.lastCheckedAt) >= every };
}
