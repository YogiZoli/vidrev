import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export const inputClass =
  "min-h-11 w-full rounded-md border border-input bg-surface px-4 py-3 text-base text-foreground placeholder:text-neutral-400 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/20";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(inputClass, className)} {...props} />;
}
