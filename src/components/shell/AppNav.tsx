"use client";

import { BarChart3, ChevronDown, Inbox, Megaphone, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { SETTINGS_GROUPS } from "./settings-nav";

// Home carries the approval queue, so its count is the queue count.
const TOP = [
  { href: "/app", label: "To Approve", exact: true, count: true },
  { href: "/app/campaigns", label: "Automations", live: true },
  { href: "/app/reports", label: "Reports" },
];

const BOTTOM = [
  { href: "/app", label: "To Approve", icon: Inbox, exact: true, count: true },
  { href: "/app/campaigns", label: "Automations", icon: Megaphone, live: true },
  { href: "/app/reports", label: "Reports", icon: BarChart3 },
  { href: "/app/settings", label: "Settings", icon: Settings },
];

const TAB = "inline-flex min-h-11 flex-none items-center whitespace-nowrap border-b-2 px-2.5 text-[15px] no-underline hover:text-foreground";

function isActive(path: string, href: string, exact?: boolean) {
  return exact ? path === href : path === href || path.startsWith(`${href}/`);
}

// Green, softly pinging dot: at least one automation is live.
function LiveDot({ on, className }: { on: boolean; className?: string }) {
  if (!on) return null;
  return (
    <span className={cn("relative ml-1.5 inline-flex size-2", className)} role="img" aria-label="live">
      <span aria-hidden className="absolute inline-flex size-full animate-ping-slow rounded-full bg-success opacity-60" />
      <span aria-hidden className="relative inline-flex size-2 rounded-full bg-success" />
    </span>
  );
}

function CountPill({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <span className="ml-1.5 inline-block h-5 min-w-5 rounded-full bg-primary px-1.5 text-center text-[11px] font-bold leading-5 text-primary-foreground">
      {n}
    </span>
  );
}

// Settings tab with a dropdown of grouped sub-pages.
function SettingsMenu({ path }: { path: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = isActive(path, "/app/settings");
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative flex-none">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((v) => !v)}
        className={cn(TAB, "cursor-pointer gap-1 bg-transparent", active ? "border-primary font-bold text-foreground" : "border-transparent font-medium text-muted-foreground")}
      >
        Settings <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-20 mt-1 grid w-64 gap-3 rounded-lg border border-border bg-surface p-3 shadow-lg">
          {SETTINGS_GROUPS.map((g) => (
            <div key={g.label} className="grid gap-0.5">
              <span className="px-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{g.label}</span>
              {g.links.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  aria-current={path === l.href ? "page" : undefined}
                  onClick={() => setOpen(false)}
                  className={cn("rounded-md px-2 py-1.5 text-[15px] no-underline hover:bg-background", path === l.href ? "font-bold text-foreground" : "text-label")}
                >
                  {l.label}
                </Link>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// Underline tabs from md up (Owner admin joins when the user is the owner).
export function TopTabs({ queueCount, isAdmin, liveCount = 0 }: { queueCount: number; isAdmin: boolean; liveCount?: number }) {
  const path = usePathname();
  const items: { href: string; label: string; exact?: boolean; count?: boolean; live?: boolean }[] = TOP;
  const adminActive = isActive(path, "/admin");
  return (
    <nav aria-label="Main" className="-mx-1 hidden gap-1 md:flex">
      {items.map((t) => {
        const active = isActive(path, t.href, t.exact);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(TAB, active ? "border-primary font-bold text-foreground" : "border-transparent font-medium text-muted-foreground")}
          >
            {t.label}
            {t.count ? <CountPill n={queueCount} /> : null}
            {t.live ? <LiveDot on={liveCount > 0} /> : null}
          </Link>
        );
      })}
      <SettingsMenu path={path} />
      {isAdmin ? (
        <Link
          href="/admin"
          aria-current={adminActive ? "page" : undefined}
          className={cn(TAB, adminActive ? "border-primary font-bold text-foreground" : "border-transparent font-medium text-muted-foreground")}
        >
          Owner admin
        </Link>
      ) : null}
    </nav>
  );
}

// Four-item bottom tab bar on phones.
export function BottomTabs({ queueCount, liveCount = 0 }: { queueCount: number; liveCount?: number }) {
  const path = usePathname();
  return (
    <nav
      aria-label="Main"
      className="sticky bottom-0 z-10 grid grid-cols-4 border-t border-border bg-white/90 px-1 pt-1.5 backdrop-blur-md md:hidden"
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
              {"live" in b && b.live && liveCount > 0 ? <LiveDot on className="absolute -right-2.5 -top-0.5 ml-0" /> : null}
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
