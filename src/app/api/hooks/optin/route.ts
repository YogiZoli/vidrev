import { handleInbound } from "@/server/integrations/inbound-http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// A subscriber opted in on the creator's page (SPEC section 9).
export function POST(request: Request): Promise<Response> {
  return handleInbound(request, "optin");
}
