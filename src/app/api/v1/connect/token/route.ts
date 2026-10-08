import { clientIp } from "@/lib/client-ip";
import { tokenRoute } from "@/server/pdt-api";
import { pdtDeps } from "@/server/pdt-deps";
import { guarded } from "@/server/route-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// PDT trades the one-time connect code for its token (DECISIONS A-30).
export const POST = guarded("/api/v1/connect/token", (request: Request) => tokenRoute(pdtDeps(), request, clientIp(request.headers)));
