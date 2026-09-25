import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Notice({ tone, children }: { tone: "info" | "error"; children: ReactNode }) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "my-4 rounded-lg border p-3 text-sm",
        tone === "error" ? "border-danger/40 bg-danger-surface text-neutral-800" : "border-success/30 bg-success-surface text-neutral-800",
      )}
    >
      {children}
    </p>
  );
}
