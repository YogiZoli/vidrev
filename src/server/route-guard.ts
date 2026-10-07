import { randomBytes } from "node:crypto";
import { errorFields, log } from "@/lib/log";
import { redirectTo } from "./http";

// A short reference the creator can send us; it is on the log line.
export function errorRef(): string {
  return randomBytes(4).toString("hex");
}

// A plain form post or a link the browser follows: a failure must land on a
// page, not on a bare "Internal Server Error".
function fromBrowser(request: Request): boolean {
  const type = request.headers.get("content-type") ?? "";
  if (type.startsWith("application/x-www-form-urlencoded") || type.startsWith("multipart/form-data")) return true;
  return request.method === "GET" && (request.headers.get("accept") ?? "").includes("text/html");
}

// Only a path on this app, so the "Go back" link cannot point elsewhere.
function backPath(request: Request): string | null {
  const referer = request.headers.get("referer");
  if (!referer) return null;
  try {
    const url = new URL(referer);
    return url.host === new URL(request.url).host || url.host === request.headers.get("host") ? url.pathname : null;
  } catch {
    return null;
  }
}

// Wraps a route handler: an unexpected error is logged with a reference and
// the route, then a browser goes to /oops (reference and a way back) and an
// API caller gets JSON with the same reference. Nothing is shown raw.
export function guarded<A extends unknown[]>(route: string, handler: (request: Request, ...rest: A) => Promise<Response>) {
  return async (request: Request, ...rest: A): Promise<Response> => {
    try {
      return await handler(request, ...rest);
    } catch (error) {
      const ref = errorRef();
      log("error", "request failed", { method: request.method, path: new URL(request.url).pathname, route, ref, ...errorFields(error) });
      if (fromBrowser(request)) {
        const back = backPath(request);
        return redirectTo(`/oops?ref=${ref}${back ? `&back=${encodeURIComponent(back)}` : ""}`);
      }
      return Response.json({ error: `Something went wrong on our side. Try again. Reference: ${ref}` }, { status: 500 });
    }
  };
}
