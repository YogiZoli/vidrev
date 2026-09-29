import type { FetchLike } from "@/server/google/oauth";

// HighLevel (GoHighLevel) API v2 client, location level (SPEC section 14).
// Endpoint shapes follow the public OpenAPI files in GoHighLevel/highlevel-api-docs;
// the ones marked "verify live" are checked against a real location when the
// owner's Private Marketplace app exists (docs/SETUP-GHL.md).

export const GHL_API = "https://services.leadconnectorhq.com";
export const GHL_VERSION = "2021-07-28";

export class GhlApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    path: string,
  ) {
    super(`GHL ${status} on ${path}`);
    this.name = "GhlApiError";
  }
}

export interface GhlContact {
  id: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  contactName?: string | null;
  name?: string | null;
  tags?: string[];
  customFields?: { id: string; value?: unknown }[];
  dateAdded?: string;
  dateUpdated?: string;
  attributionSource?: { utmContent?: string | null } | null;
  lastAttributionSource?: { utmContent?: string | null } | null;
}

export interface GhlOpportunity {
  id: string;
  status?: string;
  monetaryValue?: number;
  contactId?: string;
  contact?: { id?: string; email?: string | null; name?: string | null } | null;
  lastStatusChangeAt?: string;
  updatedAt?: string;
  createdAt?: string;
}

export interface GhlTransaction {
  _id: string;
  amount?: number;
  currency?: string;
  status?: string;
  contactId?: string;
  contactEmail?: string | null;
  contactName?: string | null;
  subscriptionId?: string | null;
  createdAt?: string;
  refunds?: { amount?: number }[];
}

export interface GhlCustomField {
  id: string;
  name?: string;
  fieldKey?: string;
}

type Query = Record<string, string | number | undefined>;

export interface GhlFunnel {
  _id: string;
  name?: string;
  type?: string;
  url?: string;
  steps?: { id?: string; name?: string; url?: string; type?: string }[];
}

export function createGhlApi(fetchImpl: FetchLike, accessToken: string) {
  async function call<T>(path: string, options: { method?: "GET" | "POST"; query?: Query; body?: unknown } = {}): Promise<T> {
    const url = new URL(`${GHL_API}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) if (value !== undefined) url.searchParams.set(key, String(value));
    const response = await fetchImpl(url.toString(), {
      method: options.method ?? "GET",
      headers: {
        authorization: `Bearer ${accessToken}`,
        version: GHL_VERSION,
        accept: "application/json",
        ...(options.body ? { "content-type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const text = await response.text();
    if (!response.ok) throw new GhlApiError(response.status, text.slice(0, 500), path);
    return (text ? JSON.parse(text) : {}) as T;
  }

  // Name and website of the Sub-account; the website prefills the target URL in onboarding.
  async function getLocation(locationId: string): Promise<{ name: string | null; website: string | null }> {
    const json = await call<{ location?: { name?: string; website?: string } }>(`/locations/${locationId}`);
    return { name: json.location?.name ?? null, website: json.location?.website?.trim() || null };
  }

  return {
    async getLocationName(locationId: string): Promise<string | null> {
      return (await getLocation(locationId)).name;
    },

    getLocation,

    // Funnels and websites with their steps (paths only; GoHighLevel does not
    // expose the domain name through the API). Needs funnels/funnel.readonly.
    async listFunnels(locationId: string): Promise<GhlFunnel[]> {
      const json = await call<{ funnels?: GhlFunnel[] }>("/funnels/funnel/list", { query: { locationId, limit: 100 } });
      return json.funnels ?? [];
    },

    // Needs surveys.readonly.
    async listSurveys(locationId: string): Promise<{ id: string; name: string }[]> {
      const json = await call<{ surveys?: { id?: string; _id?: string; name?: string }[] }>("/surveys/", { query: { locationId, limit: 100 } });
      return (json.surveys ?? []).map((s) => ({ id: String(s.id ?? s._id ?? ""), name: s.name ?? "Survey" })).filter((s) => s.id);
    },

    // Needs calendars.readonly.
    async listCalendars(locationId: string): Promise<{ id: string; name: string }[]> {
      const json = await call<{ calendars?: { id?: string; name?: string; isActive?: boolean }[] }>("/calendars/", { query: { locationId } });
      return (json.calendars ?? [])
        .filter((c) => c.isActive !== false)
        .map((c) => ({ id: String(c.id ?? ""), name: c.name ?? "Calendar" }))
        .filter((c) => c.id);
    },

    async listContactFields(locationId: string): Promise<GhlCustomField[]> {
      const json = await call<{ customFields?: GhlCustomField[] }>(`/locations/${locationId}/customFields`, { query: { model: "contact" } });
      return json.customFields ?? [];
    },

    // verify live: the response wraps the field as { customField } in the current API.
    async createContactField(locationId: string, name: string): Promise<GhlCustomField> {
      const json = await call<{ customField?: GhlCustomField } & Partial<GhlCustomField>>(`/locations/${locationId}/customFields`, {
        method: "POST",
        body: { name, dataType: "TEXT", model: "contact" },
      });
      const field = json.customField ?? (json.id ? (json as GhlCustomField) : null);
      if (!field) throw new GhlApiError(502, "custom field response had no id", "customFields");
      return field;
    },

    async getContact(contactId: string): Promise<GhlContact | null> {
      try {
        const json = await call<{ contact?: GhlContact }>(`/contacts/${contactId}`);
        return json.contact ?? null;
      } catch (error) {
        if (error instanceof GhlApiError && error.status === 404) return null;
        throw error;
      }
    },

    async upsertContact(locationId: string, input: { email: string; name?: string | null; customFields?: { id: string; value: string }[] }): Promise<string> {
      const json = await call<{ contact?: { id?: string } }>(`/contacts/upsert`, {
        method: "POST",
        body: {
          locationId,
          email: input.email,
          ...(input.name ? { name: input.name } : {}),
          ...(input.customFields?.length ? { customFields: input.customFields } : {}),
        },
      });
      if (!json.contact?.id) throw new GhlApiError(502, "upsert response had no contact id", "contacts/upsert");
      return json.contact.id;
    },

    // Additive: existing tags stay (upsert itself may replace them).
    async addTags(contactId: string, tags: string[]): Promise<void> {
      await call(`/contacts/${contactId}/tags`, { method: "POST", body: { tags } });
    },

    // verify live: `userId` may be optional; the installing user's id is sent when known.
    async addNote(contactId: string, body: string, userId?: string | null): Promise<void> {
      await call(`/contacts/${contactId}/notes`, { method: "POST", body: { body, ...(userId ? { userId } : {}) } });
    },

    // verify live: deprecated list endpoint, newest first; paged with startAfterId.
    async listContacts(locationId: string, page: { startAfterId?: string; startAfter?: string | number } = {}) {
      const json = await call<{ contacts?: GhlContact[]; meta?: { startAfterId?: string; startAfter?: string | number; nextPageUrl?: string | null } }>(`/contacts/`, {
        query: { locationId, limit: 100, startAfterId: page.startAfterId, startAfter: page.startAfter },
      });
      return { contacts: json.contacts ?? [], next: json.meta?.startAfterId ? { startAfterId: json.meta.startAfterId, startAfter: json.meta.startAfter } : null };
    },

    async listWonOpportunities(locationId: string, page: number) {
      const json = await call<{ opportunities?: GhlOpportunity[]; meta?: { nextPage?: number | null } }>(`/opportunities/search`, {
        query: { location_id: locationId, status: "won", limit: 100, page },
      });
      return { opportunities: json.opportunities ?? [], hasMore: Boolean(json.meta?.nextPage) };
    },

    // verify live: `amount` is in currency units (97 = 97.00) in this endpoint.
    async listTransactions(locationId: string, input: { startAt: Date; endAt: Date; offset: number }) {
      const json = await call<{ data?: GhlTransaction[]; totalCount?: number }>(`/payments/transactions`, {
        query: {
          altId: locationId,
          altType: "location",
          limit: 100,
          offset: input.offset,
          startAt: input.startAt.toISOString(),
          endAt: input.endAt.toISOString(),
        },
      });
      return { transactions: json.data ?? [], total: json.totalCount ?? 0 };
    },
  };
}

export type GhlApi = ReturnType<typeof createGhlApi>;
