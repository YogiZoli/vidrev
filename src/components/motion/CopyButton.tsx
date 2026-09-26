"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

// Copy buttons flip to "Copied" for 1.6 seconds.
export function useCopied() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const flip = () => {
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  };
  return { copied, flip };
}

export function CopyButton({ text, label = "Copy", className }: { text: string; label?: string; className?: string }) {
  const { copied, flip } = useCopied();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn("flex-none", className)}
      aria-label={copied ? "Copied" : `${label} to clipboard`}
      onClick={async () => {
        await navigator.clipboard.writeText(text).catch(() => {});
        flip();
      }}
    >
      {copied ? <Check className="size-4 text-success" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      {copied ? "Copied" : label}
    </Button>
  );
}

// Machine text (a link, a token, a DNS value) with its copy button.
export function CopyMono({ text, className }: { text: string; className?: string }) {
  return (
    <span className={cn("flex flex-wrap items-center gap-2", className)}>
      <code className="min-w-0 break-all font-mono text-[13px]">{text}</code>
      <CopyButton text={text} />
    </span>
  );
}
