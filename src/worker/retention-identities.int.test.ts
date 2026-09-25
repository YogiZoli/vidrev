import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/db/client";
import { channels, contactIdentities, contacts } from "@/db/schema";
import { encryptSecret } from "@/lib/crypto";
import { runMigrations } from "@/scripts/migrate";
import { createAccountWithUser } from "@/server/accounts";
import { resolveContact } from "@/server/contacts";
import { runRetention } from "./retention";

const hasDb = Boolean(process.env.DATABASE_URL);
const key = randomBytes(32).toString("base64");
const now = new Date("2026-09-26T12:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);

// DECISIONS 13.9: a commenter channel id is YouTube data, so it is confirmed
// with YouTube every 30 days or deleted; the Contact and its history stay.
describe.skipIf(!hasDb)("retention of commenter identities (integration)", () => {
  beforeAll(async () => {
    await runMigrations(process.env.DATABASE_URL!);
  });

  afterAll(async () => {
    await closeDb();
  });

  async function setup(status: "connected" | "disconnected" = "connected") {
    const db = getDb();
    const { account } = await createAccountWithUser(db, { email: `ri-${randomUUID()}@example.com`, planCode: "standard_monthly" });
    const [channel] = await db
      .insert(channels)
      .values({
        accountId: account.id,
        youtubeChannelId: `UC${randomUUID()}`,
        status,
        titleRefreshedAt: now,
        title: "T",
        accessTokenEnc: encryptSecret("a", key),
        refreshTokenEnc: encryptSecret("r", key),
        tokenExpiresAt: new Date(now.getTime() + 3_600_000),
      })
      .returning();
    return { account, channel: channel! };
  }

  const person = (accountId: string, channelId: string, author: string, ref: string | null, seenDaysAgo: number) =>
    resolveContact(getDb(), {
      accountId,
      keys: { youtubeChannel: author },
      event: "comment",
      createdVia: "comment",
      source: "test",
      at: daysAgo(seenDaysAgo),
      channelId,
      refCommentId: ref,
    });

  it("confirms what YouTube still shows, deletes what it does not, and never deletes a Contact", async () => {
    const db = getDb();
    const { account, channel } = await setup();
    const authorA = `UCa${randomUUID()}`;
    const authorB = `UCb${randomUUID()}`;
    const authorC = `UCc${randomUUID()}`;
    const authorD = `UCd${randomUUID()}`;
    const a = await person(account.id, channel.id, authorA, "cA", 28);
    const b = await person(account.id, channel.id, authorB, "cB", 28);
    const c = await person(account.id, channel.id, authorC, "cC", 10);
    const d = await person(account.id, channel.id, authorD, null, 31);

    const requested: string[] = [];
    const result = await runRetention({
      db,
      fetch: async (url) => {
        requested.push(String(url));
        // cA is still there with the same author; cB was deleted by its author.
        return Response.json({ items: [{ id: "cA", snippet: { authorChannelId: { value: authorA } } }] });
      },
      encryptionKey: key,
      google: { clientId: "c", clientSecret: "s" },
      now: () => now,
      quotaLimit: 1_000_000_000,
      enqueue: async () => {},
    });

    const rows = await db.select().from(contactIdentities).where(eq(contactIdentities.accountId, account.id));
    const byValue = new Map(rows.map((r) => [r.value, r]));
    expect(byValue.get(authorA)!.refreshDueAt!.getTime()).toBe(now.getTime() + 30 * 86_400_000);
    expect(byValue.has(authorB)).toBe(false);
    expect(byValue.get(authorC)!.refreshDueAt!.getTime()).toBe(daysAgo(10).getTime() + 30 * 86_400_000);
    expect(byValue.has(authorD)).toBe(false);
    expect(result).toMatchObject({ identitiesRefreshed: 1, identitiesDeleted: 2 });
    // One call covered both due comments.
    expect(requested.filter((u) => u.includes("/comments?"))).toHaveLength(1);
    expect(requested[0]).toMatch(/id=c[AB]%2Cc[AB]/);

    // Every Contact is still there.
    const people = await db.select().from(contacts).where(eq(contacts.accountId, account.id));
    expect(people.map((p) => p.id).sort()).toEqual([a.contactId, b.contactId, c.contactId, d.contactId].sort());
  });

  it("deletes the commenter identities of a disconnected channel and keeps the Contacts", async () => {
    const db = getDb();
    const { account, channel } = await setup("disconnected");
    const made = await person(account.id, channel.id, `UC${randomUUID()}`, "c1", 1);
    await runRetention({
      db,
      fetch: async () => new Response(null, { status: 500 }),
      encryptionKey: key,
      google: { clientId: "c", clientSecret: "s" },
      now: () => now,
      quotaLimit: 1_000_000_000,
      enqueue: async () => {},
    });
    expect(await db.select().from(contactIdentities).where(eq(contactIdentities.contactId, made.contactId))).toEqual([]);
    expect(await db.select().from(contacts).where(eq(contacts.id, made.contactId))).toHaveLength(1);
  });
});
