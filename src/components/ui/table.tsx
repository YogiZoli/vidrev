import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

// Report tables: 12/700 uppercase headers, hairline rows, scrolls sideways on
// phones instead of squeezing the columns.
export function TableWrap({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("overflow-x-auto rounded-lg border border-border bg-surface", className)} {...props} />;
}

export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return <table className={cn("w-full border-collapse text-[15px]", className)} {...props} />;
}

export function Th({ className, num, ...props }: ThHTMLAttributes<HTMLTableCellElement> & { num?: boolean }) {
  return (
    <th
      className={cn("whitespace-nowrap border-b border-border px-3 py-2.5 text-xs font-bold uppercase tracking-[0.06em] text-label", num ? "text-right" : "text-left", className)}
      {...props}
    />
  );
}

export function Td({ className, num, ...props }: TdHTMLAttributes<HTMLTableCellElement> & { num?: boolean }) {
  return <td className={cn("border-b border-border px-3 py-3 align-top", num && "whitespace-nowrap text-right", className)} {...props} />;
}
