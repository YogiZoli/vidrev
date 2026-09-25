import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("my-4 rounded-lg border border-border bg-surface p-5 text-foreground shadow-xs", className)} {...props} />;
}
