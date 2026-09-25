import { STRIPE_API_VERSION, type StripeCharge } from "@/lib/stripe";
import type { FetchLike } from "@/server/google/oauth";

// Minimal read-only Stripe client (DECISIONS P8-02). Only GET requests; the
// creator's restricted key cannot do more anyway.
const API = "https://api.stripe.com/v1";

export class StripeApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "StripeApiError";
  }

  // The key was refused or lacks a permission: the creator has to act.
  get keyRejected(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

export interface StripeApi {
  listCharges(options: { gte: Date; startingAfter?: string; limit?: number }): Promise<{ charges: StripeCharge[]; hasMore: boolean }>;
  // Best effort: a restricted key may not be allowed to read the account.
  getAccount(): Promise<{ id: string; name: string | null } | null>;
}

export function createStripeApi(fetchImpl: FetchLike, apiKey: string): StripeApi {
  async function get<T>(path: string, params: URLSearchParams): Promise<T> {
    const query = params.toString();
    const response = await fetchImpl(`${API}${path}${query ? `?${query}` : ""}`, {
      method: "GET",
      headers: { authorization: `Bearer ${apiKey}`, "stripe-version": STRIPE_API_VERSION },
    });
    const json = (await response.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
    if (!response.ok) {
      throw new StripeApiError(response.status, json.error?.code ?? `http_${response.status}`, json.error?.message ?? `Stripe ${path} failed`);
    }
    return json as T;
  }

  return {
    async listCharges({ gte, startingAfter, limit = 100 }) {
      const params = new URLSearchParams({ limit: String(limit), "created[gte]": String(Math.floor(gte.getTime() / 1000)) });
      params.append("expand[]", "data.customer");
      params.append("expand[]", "data.invoice");
      if (startingAfter) params.set("starting_after", startingAfter);
      const page = await get<{ data?: StripeCharge[]; has_more?: boolean }>("/charges", params);
      return { charges: page.data ?? [], hasMore: Boolean(page.has_more) };
    },
    async getAccount() {
      try {
        const account = await get<{ id?: string; business_profile?: { name?: string | null } | null; settings?: { dashboard?: { display_name?: string | null } } }>("/account", new URLSearchParams());
        return account.id ? { id: account.id, name: account.business_profile?.name ?? account.settings?.dashboard?.display_name ?? null } : null;
      } catch {
        return null;
      }
    },
  };
}
