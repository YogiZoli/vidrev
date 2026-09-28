"use client";

import { ErrorPanel } from "@/components/errors/ErrorPanel";
import "./globals.css";

// The root layout itself failed: this page brings its own html and body.
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body>
        <ErrorPanel digest={error.digest} retry={retry} />
      </body>
    </html>
  );
}
