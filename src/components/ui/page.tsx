import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

// Page column: centred, 16px gutter, 20px rhythm between blocks.
const pageVariants = cva("mx-auto grid content-start gap-5 px-4 pb-16 pt-7", {
  variants: { width: { sm: "max-w-[560px]", md: "max-w-[720px]", lg: "max-w-[960px]", xl: "max-w-[1040px]" } },
  defaultVariants: { width: "lg" },
});

export function Page({ className, width, ...props }: HTMLAttributes<HTMLElement> & VariantProps<typeof pageVariants>) {
  return <main className={cn(pageVariants({ width }), className)} {...props} />;
}

export function PageHeader({ title, lead, children }: { title: ReactNode; lead?: ReactNode; children?: ReactNode }) {
  return (
    <div className="grid gap-2">
      <h1 className="m-0 text-[28px] font-bold leading-tight tracking-[-0.016em]">{title}</h1>
      {lead ? <p className="m-0 max-w-[68ch] text-base text-label">{lead}</p> : null}
      {children}
    </div>
  );
}

export function SectionTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("m-0 text-lg font-bold", className)} {...props} />;
}

export function Meta({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("m-0 text-[13px] leading-normal text-muted-foreground", className)} {...props} />;
}

// Definition list in two columns (label grey, value ink).
export function Facts({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[15px]">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="m-0 [overflow-wrap:anywhere]">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
