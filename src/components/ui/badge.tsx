import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

// Pill: 12/700, surface tint plus the deep text of the same hue.
const badgeVariants = cva("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold", {
  variants: {
    tone: {
      primary: "bg-primary-surface text-primary-surface-foreground",
      live: "bg-live-50 text-live-700",
      success: "bg-success-surface text-success",
      warning: "bg-warning-surface text-warning-text",
      danger: "bg-danger-surface text-danger-text",
      neutral: "bg-muted text-label",
    },
  },
  defaultVariants: { tone: "primary" },
});

export function Badge({ className, tone, ...props }: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

// Keyword chip: mono 13 on a light grey, radius 6.
export function Keyword({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("inline-flex items-center rounded-sm bg-muted px-2 py-0.5 font-mono text-[13px] text-foreground", className)} {...props} />;
}

// Lead temperature chip: Cold blue, Warm amber, Hot red, with a dot.
const TEMPERATURE_STYLE = {
  cold: "bg-cold-surface text-cold-text [--dot:var(--cold-dot)]",
  warm: "bg-warm-surface text-warm-text [--dot:var(--warm-dot)]",
  hot: "bg-hot-surface text-hot-text [--dot:var(--hot-dot)]",
} as const;
const TEMPERATURE_TEXT = { cold: "Cold", warm: "Warm", hot: "Hot" } as const;

export function TemperatureChip({ temperature, className }: { temperature: keyof typeof TEMPERATURE_STYLE; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-bold", TEMPERATURE_STYLE[temperature], className)}>
      <span aria-hidden className="size-1.5 rounded-full bg-[var(--dot)]" />
      {TEMPERATURE_TEXT[temperature]}
      <span className="sr-only"> lead</span>
    </span>
  );
}

// Intent tag: outline, 11/700.
export function IntentTag({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("inline-flex items-center rounded-full border border-border-strong px-2 py-0.5 text-[11px] font-bold text-label", className)} {...props} />;
}

// Eyebrow: 12/700 uppercase, wide tracking, 6px dot (live by default).
export function Eyebrow({ className, children, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn("m-0 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.08em] text-label", className)} {...props}>
      <span aria-hidden className="size-1.5 flex-none rounded-full bg-live" />
      {children}
    </p>
  );
}
