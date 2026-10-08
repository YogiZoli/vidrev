import { outcomesRoute } from "@/server/pdt-api";
import { pdtDeps } from "@/server/pdt-deps";
import { guarded } from "@/server/route-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Counts per keyword of one video, for PDT (A-35). Counts only.
export const GET = guarded("/api/v1/videos/[videoId]/outcomes", async (request: Request, context: { params: Promise<{ videoId: string }> }) =>
  outcomesRoute(pdtDeps(), request, (await context.params).videoId),
);
