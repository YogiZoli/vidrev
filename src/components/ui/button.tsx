import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

// shadcn/ui pattern on the brand tokens. Readability rule (BRAND-GUIDE): every
// filled button is a solid fill with white text. `pulse` is the green halo, for
// the one primary action on a screen.
export const buttonVariants = cva(
  "inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-md border border-transparent px-6 py-3 text-base font-semibold leading-none no-underline transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground shadow-sm hover:bg-primary-hover hover:text-primary-foreground hover:shadow-md",
        secondary: "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary-hover hover:text-secondary-foreground hover:shadow-md",
        outline: "border-border-strong bg-surface text-foreground hover:bg-surface-alt hover:text-foreground",
        ghost: "bg-transparent px-3 text-foreground hover:bg-muted hover:text-foreground",
      },
      size: { default: "", sm: "min-h-9 px-4 py-2 text-sm" },
      pulse: { true: "animate-cta-halo", false: "" },
    },
    defaultVariants: { variant: "primary", size: "default", pulse: false },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, pulse, asChild, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size, pulse }), className)} {...props} />;
}
