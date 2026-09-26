import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

// Min height 44 (48 on public pages), radius 10, focus = primary border plus a
// 3px ring.
export const inputClass =
  "min-h-11 w-full rounded-md border border-input bg-surface px-4 py-3 text-base text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring";

export function Input({ className, large, ...props }: InputHTMLAttributes<HTMLInputElement> & { large?: boolean }) {
  return <input className={cn(inputClass, large && "min-h-12", className)} {...props} />;
}
