"use client";

import { Button } from "@/components/ui/button";

// What a creator sees when a page fails: a plain message, a way to try again,
// and the reference that matches the "request failed" log line (digest).
export function ErrorPanel({ digest, retry }: { digest?: string; retry: () => void }) {
  return (
    <main className="mx-auto grid max-w-[560px] content-start gap-4 px-4 pb-16 pt-16">
      <h1 className="m-0 text-[28px] font-bold leading-tight">Something went wrong on our side.</h1>
      <p className="m-0 text-base text-label">
        Nothing you did caused this. Try again; if it keeps happening, send us the reference below and we will find exactly what failed.
      </p>
      {digest ? (
        <p className="m-0 text-sm text-muted-foreground">
          Reference: <code className="font-mono">{digest}</code>
        </p>
      ) : null}
      <div>
        <Button type="button" onClick={() => retry()}>
          Try again
        </Button>
      </div>
    </main>
  );
}
