import { cardsRoute } from "@/server/pdt-api";
import { pdtDeps } from "@/server/pdt-deps";
import { guarded } from "@/server/route-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// A Video Publishing Card from PDT: stored, one tracked link per keyword back (A-31).
export const POST = guarded("/api/v1/cards", (request: Request) => cardsRoute(pdtDeps(), request));
