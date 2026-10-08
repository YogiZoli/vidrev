import { publishedRoute } from "@/server/pdt-api";
import { pdtDeps } from "@/server/pdt-deps";
import { guarded } from "@/server/route-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// PDT published the video: the card's keywords go live on it (A-32).
export const POST = guarded("/api/v1/cards/[cardId]/published", async (request: Request, context: { params: Promise<{ cardId: string }> }) =>
  publishedRoute(pdtDeps(), request, (await context.params).cardId),
);
