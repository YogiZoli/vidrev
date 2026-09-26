"use client";

import { BarChart3, Home, Inbox, Link2, Tags } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const TOP = [
  { href: "/app", label: "Dashboard", exact: true },
  { href: "/app/queue", label: "Approval queue", count: true },
  { href: "/app/campaigns", label: "Keywords" },
  { href: "/app/reports", label: "Reports" },
  { href: "/app/domain", label: "Link domain" },
  { href: "/app/integrations", label: "Integrations" },
];

const BOTTOM = [
  { href: "/app", label: "Home", icon: Home, exact: true },
  { href: "/app/queue", label: "Queue", icon: Inbox, count: true },
  { href: "/app/campaigns", label: "Keywords", icon: Tags },
  { href: "/app/reports", label: "Reports", icon: BarChart3 },
  { href: "/app/integrations", label: "Connect", icon: Link2 },
];

function isActive(path: string, href: string, exact?: boolean) {
  return exact ? path === href : path === href || path.startsWith(`${href}/`);
}

function CountPill({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <span className="ml-1.5 inline-block h-5 min-w-5 rounded-full bg-primary px-1.5 text-center text-[11px] font-bold leading-5 text-primary-foreground">
      {n}
    </span>
  );
}

// Underline tabs from md up (Owner admin joins when the user is the owner).
export function TopTabs({ queueCount, isAdmin }: { queueCount: number; isAdmin: boolean }) {
  const path = usePathname();
  const items: { href: string; label: string; exact?: boolean; count?: boolean }[] = isAdmin ? [...TOP, { href: "/admin", label: "Owner admin" }] : TOP;
  return (
    <nav aria-label="Main" className="-mx-1 hidden gap-1 overflow-x-auto md:flex">
      {items.map((t) => {
        const active = isActive(path, t.href, t.exact);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex min-h-11 flex-none items-center whitespace-nowrap border-b-2 px-2.5 text-[15px] no-underline hover:text-foreground",
              active ? "border-primary font-bold text-foreground" : "border-transparent font-medium text-muted-foreground",
            )}
          >
            {t.label}
            {t.count ? <CountPill n={queueCount} /> : null}
          </Link>
        );
      })}
    </nav>
  );
}

// Five-item bottom tab bar on phones.
export function BottomTabs({ queueCount }: { queueCount: number }) {
  const path = usePathname();
  return (
    <nav
      aria-label="Main"
      className="sticky bottom-0 z-10 grid grid-cols-5 border-t border-border bg-white/90 px-1 pt-1.5 backdrop-blur-md md:hidden"
      style={{ paddingBottom: "calc(6px + env(safe-area-inset-bottom))" }}
    >
      {BOTTOM.map((b) => {
        const active = isActive(path, b.href, b.exact);
        const Icon = b.icon;
        return (
          <Link
            key={b.href}
            href={b.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative grid min-h-12 justify-items-center gap-0.5 px-0.5 py-1 text-xs no-underline",
              active ? "font-bold text-foreground" : "font-medium text-muted-foreground",
            )}
          >
            <span aria-hidden className={cn("h-[3px] w-[22px] rounded-full transition-colors", active ? "bg-primary" : "bg-transparent")} />
            <span className="relative">
              <Icon className="size-5" aria-hidden />
              {b.count && queueCount > 0 ? (
                <span className="absolute -right-3 -top-1.5 h-4 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] font-bold leading-4 text-primary-foreground">
                  {queueCount}
                </span>
              ) : null}
            </span>
            {b.label}
          </Link>
        );
      })}
    </nav>
  );
}
