import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// Integrations split into GoHighLevel, Stripe, Webhooks and Inbound endpoints.
// Old links and emails land on the page their notice belongs to.
export default async function IntegrationsRedirect({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const keys = Object.keys(params);
  const query = new URLSearchParams(params as Record<string, string>).toString();
  const page = keys.some((k) => k.startsWith("ghl_"))
    ? "gohighlevel"
    : keys.some((k) => k.startsWith("stripe_"))
      ? "stripe"
      : keys.includes("hook_rotated")
        ? "inbound"
        : keys.some((k) => ["added", "tested", "rotated", "removed"].includes(k))
          ? "webhooks"
          : "gohighlevel";
  redirect(`/app/settings/${page}${query ? `?${query}` : ""}`);
}
