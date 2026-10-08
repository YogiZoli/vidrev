import { revokeRoute } from "@/server/pdt-api";
import { pdtDeps } from "@/server/pdt-deps";
import { guarded } from "@/server/route-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// PDT disconnects: the token stops working at once.
export const POST = guarded("/api/v1/connect/revoke", (request: Request) => revokeRoute(pdtDeps(), request));
