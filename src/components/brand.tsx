import { productName } from "@/app/ui";

// The mark plus the lowercase name; used in the app header and on sign-in.
export function Brand({ size = 32 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2 font-bold tracking-tight text-foreground">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/vidrev-logo.png" width={size} height={size} alt="" className="rounded-md" />
      <span>{productName()}</span>
    </span>
  );
}
