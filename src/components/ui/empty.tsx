import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

// Empty state: a radar ping and one plain sentence.
export function EmptyState({ title, children, className }: { title: string; children?: ReactNode; className?: string }) {
  return (
    <div className={cn("grid justify-items-center gap-3 rounded-lg border border-dashed border-border-strong bg-surface p-8 text-center", className)}>
      <span aria-hidden className="relative inline-flex size-3">
        <span className="absolute inset-0 animate-ping-slow rounded-full bg-live" />
        <span className="relative size-3 rounded-full bg-live" />
      </span>
      <p className="m-0 text-lg font-bold">{title}</p>
      {children ? <p className="m-0 max-w-[48ch] text-[15px] text-muted-foreground">{children}</p> : null}
    </div>
  );
}

// Shimmer placeholder, used by the loading states.
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden className={cn("skeleton h-4", className)} {...props} />;
}
