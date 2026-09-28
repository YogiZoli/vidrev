"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { SETTINGS_GROUPS } from "./settings-nav";

export function SettingsSideNav() {
  const path = usePathname();
  return (
    <nav aria-label="Settings" className="flex flex-wrap content-start gap-x-6 gap-y-3 px-4 pt-6 lg:grid lg:gap-4 lg:px-0 lg:pt-8">
      {SETTINGS_GROUPS.map((g) => (
        <div key={g.label} className="grid gap-0.5">
          <span className="px-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{g.label}</span>
          <div className="flex flex-wrap gap-1 lg:grid lg:gap-0.5">
            {g.links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                aria-current={path === l.href ? "page" : undefined}
                className={cn(
                  "rounded-md px-2 py-1.5 text-[15px] no-underline hover:bg-surface",
                  path === l.href ? "bg-surface font-bold text-foreground" : "text-label",
                )}
              >
                {l.label}
              </Link>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}
