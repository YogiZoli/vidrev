import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/db/client";
import { contactIdentities, contacts, links, subscribers } from "@/db/schema";
import { newTid } from "@/lib/links";
import { runMigrations } from "@/scripts/migrate";
import { createAccountWithUser } from "@/server/accounts";
import { actionResponse, findSource } from "./action";
import { connectGhl } from "./connect";

const hasDb = Boolean(process.env.DATABASE_URL);
const key = randomBytes(32).toString("base64");
const db = () => getDb();

async function rig() {
  const { account } = await createAccountWithUser(db(), { email: `act-${randomUUID()}@example.com`, planCode: "standard_monthly" });
  const location = `LOC-${randomUUID()}`;
  const connected = await connectGhl(db(), key, account.id, { access_token: "a", refresh_token: "r", expires_in: 86_399, userType: "Location", locationId: location });
  if (!connected.ok) throw new Error(connected.error);
  return { accountId: account.id, location, integrationId: connected.id };
}

async function person(accountId: string, ghlContactId: string, stage: "commenter" | "subscriber" | "buyer" = "subscriber") {
  const now = new Date();
  const [contact] = await db().insert(contacts).values({ accountId, stage, createdVia: "comment", firstSeenAt: now, lastSeenAt: now }).returning();
  await db().insert(contactIdentities).values({ accountId, contactId: contact!.id, kind: "ghl_contact", value: ghlContactId, source: "test", firstSeenAt: now });
  return contact!.id;
}

async function optIn(accountId: string, contactId: string, input: { video: string; keyword: string; intent: "hot" | "warm" | "cold"; at: Date }) {
  const [link] = await db()
    .insert(links)
    .values({ accountId, kind: "static", slug: newTid().slice(0, 7), host: "go.vidrev.app", youtubeVideoId: input.video, keyword: input.keyword, intent: input.intent, destinationUrl: "https://coach.com/optin" })
    .returning();
  await db().insert(subscribers).values({
    accountId,
    emailNorm: `p-${randomUUID()}@example.com`,
    contactId,
    source: "webhook",
    dedupeKey: randomUUID(),
    linkId: link!.id,
    youtubeVideoId: input.video,
    keyword: input.keyword,
    occurredAt: input.at,
  });
}

describe.skipIf(!hasDb)("workflow action lookup (integration)", () => {
  beforeAll(async () => {
    await runMigrations(process.env.DATABASE_URL!);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("finds the latest attributed opt-in of the person behind a HighLevel contact", async () => {
    const r = await rig();
    const contactId = await person(r.accountId, "GHL-C1");
    await optIn(r.accountId, contactId, { video: "AAAAAAAAAAA", keyword: "guide", intent: "warm", at: new Date("2026-09-01T10:00:00Z") });
    await optIn(r.accountId, contactId, { video: "BBBBBBBBBBB", keyword: "price", intent: "hot", at: new Date("2026-09-10T10:00:00Z") });

    const lookup = await findSource(db(), r.location, "GHL-C1");
    if (lookup.status !== "ok") throw new Error(lookup.status);
    expect(lookup).toMatchObject({ accountId: r.accountId, integrationId: r.integrationId });
    expect(actionResponse(lookup)).toEqual({
      found: "yes",
      video_id: "BBBBBBBBBBB",
      video_url: "https://www.youtube.com/watch?v=BBBBBBBBBBB",
      keyword: "price",
      intent: "hot",
      stage: "subscriber",
      opted_in_at: "2026-09-10T10:00:00.000Z",
    });
  });

  it("says no source for a known contact without an attributed opt-in and for an unknown contact", async () => {
    const r = await rig();
    await person(r.accountId, "GHL-C2", "commenter");
    expect(await findSource(db(), r.location, "GHL-C2")).toMatchObject({ status: "no_source", accountId: r.accountId });
    expect(await findSource(db(), r.location, "GHL-NOBODY")).toMatchObject({ status: "no_source" });
  });

  it("never answers for a location that is not connected, or with another account's people", async () => {
    const a = await rig();
    const b = await rig();
    const contactId = await person(a.accountId, "GHL-SHARED");
    await optIn(a.accountId, contactId, { video: "CCCCCCCCCCC", keyword: "guide", intent: "warm", at: new Date() });

    expect(await findSource(db(), `LOC-${randomUUID()}`, "GHL-SHARED")).toEqual({ status: "unknown_location" });
    // The same HighLevel contact id asked through account B's location finds nothing of A's.
    expect(await findSource(db(), b.location, "GHL-SHARED")).toMatchObject({ status: "no_source", accountId: b.accountId });
  });
});
