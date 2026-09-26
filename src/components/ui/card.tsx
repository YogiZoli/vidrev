import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

// White, 1px border, radius 12, shadow-xs. `focus` = 1px primary border plus a
// stronger shadow; `hero` = radius 18 with the coral/freesia glow behind it.
const cardVariants = cva("border bg-surface p-5 text-foreground", {
  variants: {
    variant: {
      default: "rounded-lg border-border shadow-xs",
      focus: "rounded-lg border-primary shadow-md",
      hero: "rounded-xl border-border shadow-xs [background-image:var(--hero-glow)]",
    },
  },
  defaultVariants: { variant: "default" },
});

export function Card({ className, variant, ...props }: HTMLAttributes<HTMLDivElement> & VariantProps<typeof cardVariants>) {
  return <div className={cn(cardVariants({ variant }), className)} {...props} />;
}
