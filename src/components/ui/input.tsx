import type { InputHTMLAttributes, LabelHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

// Min height 44 (48 on public pages), radius 10, focus = primary border plus a
// 3px ring.
export const inputClass =
  "min-h-11 w-full rounded-md border border-input bg-surface px-4 py-3 text-base text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring";

export function Input({ className, large, ...props }: InputHTMLAttributes<HTMLInputElement> & { large?: boolean }) {
  return <input className={cn(inputClass, large && "min-h-12", className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(inputClass, "min-h-24 leading-normal", className)} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(inputClass, className)} {...props} />;
}

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-sm font-semibold text-foreground", className)} {...props} />;
}

// Label above a control; wraps it so a click on the label focuses it.
export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn("grid gap-1.5", className)}>
      <span className="text-sm font-semibold text-foreground">{label}</span>
      {children}
      {hint ? <span className="text-[13px] text-muted-foreground">{hint}</span> : null}
    </label>
  );
}
