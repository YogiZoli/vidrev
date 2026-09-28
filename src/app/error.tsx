"use client";

import { ErrorPanel } from "@/components/errors/ErrorPanel";

// Any page below the root layout (app, onboarding, audit, admin). The server
// side of the error is logged by onRequestError (src/instrumentation.ts).
export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorPanel digest={error.digest} retry={retry} />;
}
