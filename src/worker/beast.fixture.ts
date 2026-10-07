import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { accounts, campaigns, channels, comments, contacts, crmProspects, integrations, replies } from "@/db/schema";
import { createAccountWithUser } from "@/server/accounts";
import type { GhlContact, GhlMessage } from "@/server/ghl/api";
import { connectGhl } from "@/server/ghl/connect";
import type { GhlWorkerDeps } from "./ghl";

// Test fixture for the Beast Mode integration tests: an in-memory CRM and an
// account with a channel, a campaign and a connected CRM.

const key = randomBytes(32).toString("base64");
const db = () => getDb();
export const DAY = 86_400_000;

export interface Crm {
  contacts: Map<string, GhlContact>;
  creates: number;
  deletes: string[];
  failCreate: "none" | "422" | "timeout";
  fields: { id: string; name: string }[];
  conversations: { id: string; contactId: string; providerId: string }[];
  inbound: { conversationId: string; message: string }[];
  messages: Map<string, GhlMessage>;
  statuses: { messageId: string; status: string }[];
}

// A small in-memory CRM: contacts with tags and custom fields.
export function fakeCrm(crm: Crm) {
  return async (input: string, init?: RequestInit): Promise<Response> => {
    const url = new URL(input);
    const path = url.pathname;
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : {};
    if (path === "/conversations/" && method === "POST") {
      const id = `CV-${crm.conversations.length + 1}`;
      crm.conversations.push({ id, contactId: body.contactId, providerId: body.providerId });
      return Response.json({ conversation: { id } });
    }
    if (path === "/conversations/messages/inbound") {
      crm.inbound.push({ conversationId: body.conversationId, message: body.message });
      return Response.json({ messageId: "IN" });
    }
    const status = /^\/conversations\/messages\/([^/]+)\/status$/.exec(path);
    if (status) {
      crm.statuses.push({ messageId: status[1]!, status: body.status });
      return Response.json({});
    }
    const msg = /^\/conversations\/messages\/([^/]+)$/.exec(path);
    if (msg) {
      const found = crm.messages.get(msg[1]!);
      return found ? Response.json({ message: found }) : new Response("{}", { status: 404 });
    }
    if (path === "/oauth/token") return Response.json({ access_token: "a", refresh_token: "r", expires_in: 86_399 });
    if (path.endsWith("/customFields") && method === "GET") return Response.json({ customFields: crm.fields });
    if (path.endsWith("/customFields") && method === "POST") {
      const field = { id: "PF", name: body.name };
      crm.fields.push(field);
      return Response.json({ customField: field });
    }
    if (path === "/contacts/" && method === "GET") return Response.json({ contacts: [...crm.contacts.values()], meta: {} });
    if (path === "/contacts/" && method === "POST") {
      if (crm.failCreate === "422") return new Response("{}", { status: 422 });
      crm.creates += 1;
      const id = `GC-${crm.creates}-${randomUUID().slice(0, 6)}`;
      // Stored the way the API reads it back: { id, value }.
      crm.contacts.set(id, { id, name: [body.firstName, body.lastName].filter(Boolean).join(" "), tags: body.tags, customFields: (body.customFields as { id: string; field_value: string }[]).map((f) => ({ id: f.id, value: f.field_value })) });
      if (crm.failCreate === "timeout") throw new Error("socket hang up");
      return Response.json({ contact: { id } });
    }
    const tags = /^\/contacts\/([^/]+)\/tags$/.exec(path);
    if (tags) {
      const contact = crm.contacts.get(tags[1]!);
      if (contact) {
        const current = new Set(contact.tags ?? []);
        for (const tag of body.tags as string[]) {
          if (method === "DELETE") current.delete(tag);
          else current.add(tag);
        }
        contact.tags = [...current];
      }
      return Response.json({});
    }
    const one = /^\/contacts\/([^/]+)$/.exec(path);
    if (one) {
      const contact = crm.contacts.get(one[1]!);
      if (method === "DELETE") {
        crm.deletes.push(one[1]!);
        crm.contacts.delete(one[1]!);
        return Response.json({ succeded: true });
      }
      return contact ? Response.json({ contact }) : new Response("{}", { status: 404 });
    }
    return new Response("not found", { status: 404 });
  };
}

export async function rig(options: { mode?: "clean" | "beast" } = {}) {
  const email = `beast-${randomUUID()}@example.com`;
  const { account } = await createAccountWithUser(db(), { email, planCode: "standard_monthly" });
  await db().update(accounts).set({ crmSyncMode: options.mode ?? "beast", onboardedAt: new Date() }).where(eq(accounts.id, account.id));
  const [channel] = await db().insert(channels).values({ accountId: account.id, youtubeChannelId: `UC${randomUUID()}`, status: "connected" }).returning();
  const [campaign] = await db()
    .insert(campaigns)
    .values({ accountId: account.id, channelId: channel!.id, name: "Guide", keyword: "guide", destinationUrl: "https://coach.com/optin" })
    .returning();
  const location = `L-${randomUUID()}`;
  const connected = await connectGhl(db(), key, account.id, { access_token: "a", refresh_token: "r", expires_in: 86_399, userType: "Location", locationId: location });
  if (!connected.ok) throw new Error(connected.error);
  await db().update(integrations).set({ syncState: { setup: "done" } }).where(eq(integrations.id, connected.id));
  const crm: Crm = { contacts: new Map(), creates: 0, deletes: [], failCreate: "none", fields: [], conversations: [], inbound: [], messages: new Map(), statuses: [] };
  const deps: GhlWorkerDeps & { beastAllowlist?: string } = {
    db: db(),
    fetch: fakeCrm(crm),
    encryptionKey: key,
    client: { clientId: "c", clientSecret: "s" },
    enqueue: async () => {},
    beastAllowlist: email,
  };

  // One keyword comment from one commenter, with its draft.
  const comment = async (contactId?: string) => {
    const [person] = contactId
      ? [{ id: contactId }]
      : await db().insert(contacts).values({ accountId: account.id, createdVia: "comment", firstSeenAt: new Date(), lastSeenAt: new Date() }).returning();
    const [row] = await db()
      .insert(comments)
      .values({ channelId: channel!.id, youtubeCommentId: `yc-${randomUUID()}`, youtubeVideoId: "dQw4w9WgXcQ", authorName: "Jane Viewer", text: "GUIDE please", publishedAt: new Date() })
      .returning();
    const [reply] = await db()
      .insert(replies)
      .values({
        accountId: account.id,
        channelId: channel!.id,
        commentId: row!.id,
        contactId: person!.id,
        campaignId: campaign!.id,
        youtubeVideoId: "dQw4w9WgXcQ",
        keyword: "guide",
        intent: "cold",
        language: "en",
        body: "Here you go {link}",
        draftSource: "template",
      })
      .returning();
    return { replyId: reply!.id, contactId: person!.id };
  };
  const prospectOf = async (contactId: string) => (await db().select().from(crmProspects).where(eq(crmProspects.contactId, contactId)))[0];
  // Moves the clock past the 29 days for the sweep.
  const later = (days: number) => ({ ...deps, now: () => new Date(Date.now() + days * DAY) });
  return { account, deps, crm, comment, prospectOf, later, integrationId: connected.id, location, channelId: channel!.id };
}
