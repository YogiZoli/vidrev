import { handleInbound } from "@/server/integrations/inbound-http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// A buyer paid (or was refunded) in the creator's system (SPEC section 10).
export function POST(request: Request): Promise<Response> {
  return handleInbound(request, "purchase");
}
