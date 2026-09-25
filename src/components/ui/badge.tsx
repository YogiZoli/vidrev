import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-full bg-accent-surface px-3 py-1 text-xs font-semibold uppercase tracking-wide text-brand-700", className)}
      {...props}
    />
  );
}
