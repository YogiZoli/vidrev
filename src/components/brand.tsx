import { productName } from "@/app/ui";

// The mark plus the wordmark. The name is always lowercase (BRAND-GUIDE rule 9):
// "vid" in ink, "rev" in primary. Never put this inside an uppercase element.
export function Brand({ size = 32 }: { size?: number }) {
  const name = productName().toLowerCase();
  const split = name.startsWith("vid") && name.endsWith("rev") && name.length === 6;
  return (
    <span className="inline-flex items-center gap-2 font-bold normal-case tracking-tight text-foreground">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/vidrev-logo.png?v=1a" width={size} height={size} alt="" className="rounded-md" />
      {split ? (
        <span>
          vid<span className="text-primary">rev</span>
        </span>
      ) : (
        <span>{name}</span>
      )}
    </span>
  );
}
