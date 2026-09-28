import type { Instrumentation } from "next";
import { errorFields, log } from "@/lib/log";

// Web process: anything thrown outside a request would otherwise vanish.
export function register(): void {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  process.on("unhandledRejection", (reason) => log("error", "unhandled promise rejection in web", errorFields(reason)));
}

// Every server error of a page, route handler or proxy, as one structured
// line: where (route file, path without the query, which may hold tokens),
// what (error type, message, stack, cause) and the digest the error page
// shows the creator, so a reported reference finds the log line.
export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  const where = { method: request.method, path: request.path.split("?")[0], route: context.routePath, routeType: context.routeType };
  // The visitor left before the page finished streaming: not a fault.
  if (error instanceof Error && error.message === "The destination stream closed early.") {
    log("info", "request aborted by the client", where);
    return;
  }
  const digest = typeof error === "object" && error !== null && "digest" in error ? String((error as { digest: unknown }).digest) : undefined;
  log("error", "request failed", {
    ...where,
    digest,
    ...errorFields(error),
  });
};
