import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

// Radius 12. info = success surface, error = danger surface and border (warm
// orange-red, never the CTA colour).
export function Notice({ tone, children }: { tone: "info" | "error"; children: ReactNode }) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "my-4 rounded-lg border p-3 text-sm text-foreground",
        tone === "error" ? "border-danger-border bg-danger-surface" : "border-success/30 bg-success-surface",
      )}
    >
      {children}
    </p>
  );
}
