import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/db/client";
import { accounts, campaigns, channels, clicks, comments, contactIdentities, contactMerges, contacts, links, purchases, replies, subscribers } from "@/db/schema";
import { newTid } from "@/lib/links";
import { runMigrations } from "@/scripts/migrate";
import { createDraft, type DraftDeps } from "@/worker/drafts";
import { createAccountWithUser } from "./accounts";
import { runAttribution } from "./attribution";
import { backfillContacts } from "./contacts-backfill";
import { resolveContact } from "./contacts";
import { recordOptIn, recordPurchase } from "./integrations/inbound";
import { ensureReplyLink, ensureStaticLink, resolveClick } from "./links";
import { rebuildReports } from "./reports";

const hasDb = Boolean(process.env.DATABASE_URL);
const db = () => getDb();
const now = new Date("2026-09-26T12:00:00Z");
const browser = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148";
const emit = async () => {};

function draftDeps(): DraftDeps {
  return {
    db: db(),
    fetch: async () => new Response("", { status: 500 }),
    encryptionKey: undefined,
    platformAi: { apiKey: undefined, model: "test" },
    appBaseUrl: "https://app.example.com",
    productName: "Test",
    enqueue: async () => {},
    now: () => now,
  };
}

async function setup() {
  const { account } = await createAccountWithUser(db(), { email: `ct-${randomUUID()}@example.com`, planCode: "standard_monthly" });
  // Onboarding done (Phase 14): polling and drafts run only after it.
  await db().update(accounts).set({ onboardedAt: new Date() }).where(eq(accounts.id, account.id));
  const [channel] = await db()
    .insert(channels)
    .values({ accountId: account.id, youtubeChannelId: `UC${randomUUID()}`, status: "connected" })
    .returning();
  const [campaign] = await db()
    .insert(campaigns)
    .values({
      accountId: account.id,
      channelId: channel!.id,
      name: "Guide",
      keyword: "guide",
      destinationUrl: "https://coach.com/optin",
      createdAt: new Date(now.getTime() - 86_400_000),
    })
    .returning();
  return { account, channel: channel!, campaign: campaign! };
}

type Setup = Awaited<ReturnType<typeof setup>>;

// A keyword comment by `author` on `video`, drafted the way the worker does.
async function comment(s: Setup, author: string | null, video: string, minutesAgo = 0) {
  const at = new Date(now.getTime() - minutesAgo * 60_000);
  const [row] = await db()
    .insert(comments)
    .values({
      channelId: s.channel.id,
      youtubeCommentId: `c-${randomUUID()}`,
      youtubeVideoId: video,
      authorChannelId: author,
      text: "guide please",
      publishedAt: at,
      fetchedAt: at,
    })
    .returning();
  await createDraft(draftDeps(), row!.id);
  // Pin the reply to the test clock; the column default is the real clock,
  // which drifts out of the report period as the calendar moves on.
  const [reply] = await db().update(replies).set({ createdAt: at }).where(eq(replies.commentId, row!.id)).returning();
  return reply!;
}

async function liveContacts(accountId: string) {
  return db()
    .select()
    .from(contacts)
    .where(and(eq(contacts.accountId, accountId), isNull(contacts.mergedIntoId)));
}

async function clickThrough(replyId: string) {
  const link = await ensureReplyLink(db(), replyId, { fallbackHost: "go.vidrev.app" }, now);
  const slug = link!.slug;
  const result = await resolveClick(
    db(),
    { slug, host: "go.vidrev.app", ip: "203.0.113.9", userAgent: browser, country: "US", referer: null, ipSecret: "s", fallbackHost: "go.vidrev.app" },
    now,
  );
  if (result.kind !== "redirect") throw new Error("no redirect");
  return new URL(result.location).searchParams.get("vidrev_tid")!;
}

function optIn(email: string, tid: string | null, extra: { externalId?: string; name?: string } = {}) {
  return {
    email,
    name: extra.name ?? null,
    tid,
    externalId: extra.externalId ?? null,
    consentMarketing: null,
    occurredAt: new Date(now.getTime() + 60_000),
  };
}

const mail = (label: string) => `${label}-${randomUUID()}@example.com`;

describe.skipIf(!hasDb)("contacts (integration)", () => {
  beforeAll(async () => {
    await runMigrations(process.env.DATABASE_URL!);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("makes a commenter a Contact and gives the same commenter on another video the same Contact", async () => {
    const s = await setup();
    const author = `UCa${randomUUID()}`;
    const first = await comment(s, author, "VIDEO_A", 30);
    const second = await comment(s, author, "VIDEO_B", 5);
    const other = await comment(s, `UCb${randomUUID()}`, "VIDEO_A", 1);

    expect(first.contactId).toBeTruthy();
    expect(second.contactId).toBe(first.contactId);
    expect(other.contactId).not.toBe(first.contactId);
    const all = await liveContacts(s.account.id);
    expect(all).toHaveLength(2);
    const person = all.find((c) => c.id === first.contactId)!;
    expect(person).toMatchObject({ stage: "commenter", primaryEmailNorm: null, createdVia: "comment" });
    expect(person.firstCommentSeenAt!.getTime()).toBe(now.getTime() - 30 * 60_000);
    expect(person.lastSeenAt.getTime()).toBe(now.getTime() - 5 * 60_000);
    const identities = await db().select().from(contactIdentities).where(eq(contactIdentities.contactId, person.id));
    expect(identities).toHaveLength(1);
    expect(identities[0]).toMatchObject({ kind: "youtube_channel", value: author });
    expect(identities[0]!.refreshDueAt).toBeTruthy();
  });

  it("never guesses that two comments without an author id are one person", async () => {
    const s = await setup();
    const a = await comment(s, null, "VIDEO_A");
    const b = await comment(s, null, "VIDEO_B");
    expect(a.contactId).not.toBe(b.contactId);
  });

  it("updates the same Contact with the email when the commenter opts in through the tracked link", async () => {
    const s = await setup();
    const reply = await comment(s, `UC${randomUUID()}`, "VIDEO_A");
    const tid = await clickThrough(reply.id);
    const [click] = await db().select().from(clicks).where(eq(clicks.tid, tid));
    expect(click!.contactId).toBe(reply.contactId);

    const email = mail("lead");
    await recordOptIn(db(), s.account.id, optIn(email, tid, { name: "Lee" }), { source: "webhook", emit });

    const all = await liveContacts(s.account.id);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ id: reply.contactId, stage: "subscriber", primaryEmailNorm: email, displayName: "Lee" });
    expect(all[0]!.subscribedAt).toBeTruthy();
    const [sub] = await db().select().from(subscribers).where(eq(subscribers.emailNorm, email));
    expect(sub!.contactId).toBe(reply.contactId);
  });

  it("recognises the same person on a repeat opt-in and on a replay, and keeps one Contact", async () => {
    const s = await setup();
    const reply = await comment(s, `UC${randomUUID()}`, "VIDEO_A");
    const tid = await clickThrough(reply.id);
    const email = mail("twice");
    await recordOptIn(db(), s.account.id, optIn(email, tid, { externalId: "form-1" }), { source: "webhook", emit });
    await recordOptIn(db(), s.account.id, optIn(email, tid, { externalId: "form-1" }), { source: "webhook", emit });
    await recordOptIn(db(), s.account.id, optIn(email.toUpperCase().toLowerCase(), null, { externalId: "form-2" }), { source: "webhook", emit });
    expect(await liveContacts(s.account.id)).toHaveLength(1);
    const touches = await db().select().from(subscribers).where(eq(subscribers.emailNorm, email));
    expect(touches).toHaveLength(2);
    expect(new Set(touches.map((t) => t.contactId)).size).toBe(1);
  });

  it("adds a second email to the same Contact (alias) and keeps the earliest as primary", async () => {
    const s = await setup();
    const reply = await comment(s, `UC${randomUUID()}`, "VIDEO_A");
    const tid = await clickThrough(reply.id);
    const first = mail("home");
    const second = mail("work");
    await recordOptIn(db(), s.account.id, optIn(first, tid, { externalId: "a" }), { source: "webhook", emit });
    await recordOptIn(db(), s.account.id, { ...optIn(second, tid, { externalId: "b" }), occurredAt: new Date(now.getTime() + 120_000) }, { source: "webhook", emit });
    const all = await liveContacts(s.account.id);
    expect(all).toHaveLength(1);
    expect(all[0]!.primaryEmailNorm).toBe(first);
    const emails = await db()
      .select()
      .from(contactIdentities)
      .where(and(eq(contactIdentities.contactId, all[0]!.id), eq(contactIdentities.kind, "email")));
    expect(emails.map((e) => e.value).sort()).toEqual([first, second].sort());
  });

  it("finds a Contact by email when the tid was lost, and creates an email-only Contact otherwise", async () => {
    const s = await setup();
    const reply = await comment(s, `UC${randomUUID()}`, "VIDEO_A");
    const tid = await clickThrough(reply.id);
    const known = mail("known");
    await recordOptIn(db(), s.account.id, optIn(known, tid, { externalId: "a" }), { source: "webhook", emit });
    await recordOptIn(db(), s.account.id, optIn(known, null, { externalId: "b" }), { source: "webhook", emit });
    expect(await liveContacts(s.account.id)).toHaveLength(1);

    await recordOptIn(db(), s.account.id, optIn(mail("stranger"), null), { source: "webhook", emit });
    const all = await liveContacts(s.account.id);
    expect(all).toHaveLength(2);
    expect(all.find((c) => c.id !== reply.contactId)).toMatchObject({ createdVia: "opt_in", stage: "subscriber", firstCommentSeenAt: null });
  });

  it("ties a static link click to the Contact whose opt-in carried its tid", async () => {
    const s = await setup();
    const link = await ensureStaticLink(db(), { accountId: s.account.id, campaignId: s.campaign.id, youtubeVideoId: null, fallbackHost: "go.vidrev.app" }, now);
    const slug = link!.slug;
    const result = await resolveClick(
      db(),
      { slug, host: "go.vidrev.app", ip: "203.0.113.9", userAgent: browser, country: "US", referer: null, ipSecret: "s", fallbackHost: "go.vidrev.app" },
      now,
    );
    if (result.kind !== "redirect") throw new Error("no redirect");
    const tid = new URL(result.location).searchParams.get("vidrev_tid")!;
    const [before] = await db().select().from(clicks).where(eq(clicks.tid, tid));
    expect(before!.contactId).toBeNull();

    await recordOptIn(db(), s.account.id, optIn(mail("static"), tid), { source: "webhook", emit });
    const [after] = await db().select().from(clicks).where(eq(clicks.tid, tid));
    expect(after!.contactId).toBeTruthy();
    expect(await liveContacts(s.account.id)).toHaveLength(1);
  });

  it("merges two Contacts into the older one when one event ties them, and logs it", async () => {
    const s = await setup();
    const reply = await comment(s, `UC${randomUUID()}`, "VIDEO_A", 60);
    const tid = await clickThrough(reply.id);
    const shared = mail("shared");
    // An organic opt-in of the same email created a second Contact earlier in the flow.
    await recordOptIn(db(), s.account.id, optIn(shared, null, { externalId: "organic" }), { source: "webhook", emit });
    expect(await liveContacts(s.account.id)).toHaveLength(2);
    const [organic] = await db().select().from(subscribers).where(eq(subscribers.emailNorm, shared));

    await recordOptIn(db(), s.account.id, optIn(shared, tid, { externalId: "tracked" }), { source: "webhook", emit });

    const all = await liveContacts(s.account.id);
    expect(all).toHaveLength(1);
    expect(all[0]!.id).toBe(reply.contactId);
    const [moved] = await db().select().from(subscribers).where(eq(subscribers.id, organic!.id));
    expect(moved!.contactId).toBe(reply.contactId);
    const merges = await db().select().from(contactMerges).where(eq(contactMerges.winnerId, reply.contactId!));
    expect(merges).toHaveLength(1);
    expect(merges[0]).toMatchObject({ reason: "email", loserId: organic!.contactId });
    expect(merges[0]!.moved).toMatchObject({ identities: 1, subscribers: 1 });
    const [tomb] = await db().select().from(contacts).where(eq(contacts.id, organic!.contactId!));
    expect(tomb!.mergedIntoId).toBe(reply.contactId);
    // A key that pointed to the loser now resolves to the winner, without a new Contact.
    const again = await resolveContact(db(), { accountId: s.account.id, keys: { email: shared }, event: "sync", createdVia: "crm_sync", source: "test", at: now });
    expect(again).toMatchObject({ contactId: reply.contactId, created: false, merged: 0 });
  });

  it("merges three Contacts found by one event", async () => {
    const s = await setup();
    const a = await resolveContact(db(), { accountId: s.account.id, keys: { email: mail("a") }, event: "opt_in", createdVia: "opt_in", source: "t", at: new Date(now.getTime() - 3000) });
    const b = await resolveContact(db(), { accountId: s.account.id, keys: { ghlContact: `g-${randomUUID()}` }, event: "sync", createdVia: "crm_sync", source: "t", at: new Date(now.getTime() - 2000) });
    const c = await resolveContact(db(), { accountId: s.account.id, keys: { stripeCustomer: `cus_${randomUUID()}` }, event: "purchase", createdVia: "purchase", source: "t", at: new Date(now.getTime() - 1000) });
    expect(new Set([a.contactId, b.contactId, c.contactId]).size).toBe(3);
    const idents = await db().select().from(contactIdentities).where(eq(contactIdentities.accountId, s.account.id));
    const pick = (kind: string) => idents.find((i) => i.kind === kind)!.value;
    const joined = await resolveContact(db(), {
      accountId: s.account.id,
      keys: { email: pick("email"), ghlContact: pick("ghl_contact"), stripeCustomer: pick("stripe_customer") },
      event: "sync",
      createdVia: "crm_sync",
      source: "t",
      at: now,
    });
    expect(joined).toMatchObject({ contactId: a.contactId, merged: 2 });
    const live = await liveContacts(s.account.id);
    expect(live).toHaveLength(1);
    expect(live[0]!.stage).toBe("buyer");
    expect(live[0]!.firstPurchaseAt).toBeTruthy();
  });

  it("gives a buyer the same Contact by email, creates one for an unknown buyer, and never moves the stage back", async () => {
    const s = await setup();
    const reply = await comment(s, `UC${randomUUID()}`, "VIDEO_A");
    const tid = await clickThrough(reply.id);
    const email = mail("buyer");
    await recordOptIn(db(), s.account.id, optIn(email, tid), { source: "webhook", emit });

    await recordPurchase(
      db(),
      s.account.id,
      { email, tid: null, externalId: "o-1", amountCents: 9700, currency: "USD", refundedCents: null, subscriptionId: null, occurredAt: new Date(now.getTime() + 3_600_000) },
      { source: "webhook", emit },
    );
    const [paid] = await db().select().from(purchases).where(eq(purchases.externalId, "o-1"));
    expect(paid!.contactId).toBe(reply.contactId);
    expect((await liveContacts(s.account.id))[0]).toMatchObject({ stage: "buyer" });

    // A refund replays the same order: same Contact, stage stays.
    await recordPurchase(
      db(),
      s.account.id,
      { email, tid: null, externalId: "o-1", amountCents: 9700, currency: "USD", refundedCents: 9700, subscriptionId: null, occurredAt: new Date(now.getTime() + 3_600_000) },
      { source: "webhook", emit },
    );
    expect((await liveContacts(s.account.id))[0]).toMatchObject({ stage: "buyer" });
    expect(await liveContacts(s.account.id)).toHaveLength(1);

    await recordPurchase(
      db(),
      s.account.id,
      { email: mail("cold"), tid: null, externalId: "o-2", amountCents: 1000, currency: "USD", refundedCents: null, subscriptionId: null, occurredAt: now },
      { source: "webhook", emit },
    );
    const all = await liveContacts(s.account.id);
    expect(all).toHaveLength(2);
    expect(all.find((c) => c.id !== reply.contactId)).toMatchObject({ createdVia: "purchase", stage: "buyer" });
  });

  it("recognises a GHL contact id and a Stripe customer id on later events", async () => {
    const s = await setup();
    const email = mail("crm");
    const ghl = `ghl-${randomUUID()}`;
    await recordOptIn(db(), s.account.id, optIn(email, null, { externalId: "x" }), { source: "ghl", ghlContactId: ghl, emit });
    // The CRM later reports the contact under a changed email.
    await recordOptIn(db(), s.account.id, optIn(mail("renamed"), null, { externalId: "y" }), { source: "ghl", ghlContactId: ghl, emit });
    expect(await liveContacts(s.account.id)).toHaveLength(1);

    const customer = `cus_${randomUUID()}`;
    await recordPurchase(
      db(),
      s.account.id,
      { email, tid: null, externalId: "p1", amountCents: 500, currency: "USD", refundedCents: null, subscriptionId: null, occurredAt: now },
      { source: "webhook", stripeCustomerId: customer, emit },
    );
    await recordPurchase(
      db(),
      s.account.id,
      { email: mail("card-email"), tid: null, externalId: "p2", amountCents: 500, currency: "USD", refundedCents: null, subscriptionId: null, occurredAt: now },
      { source: "webhook", stripeCustomerId: customer, emit },
    );
    expect(await liveContacts(s.account.id)).toHaveLength(1);
  });

  it("attributes and reports a person once when the buyer is known by a second email of the same Contact", async () => {
    const s = await setup();
    const reply = await comment(s, `UC${randomUUID()}`, "VIDEO_A", 90);
    const tid = await clickThrough(reply.id);
    const first = mail("first");
    const second = mail("second");
    const ghl = `ghl-${randomUUID()}`;
    await recordOptIn(db(), s.account.id, optIn(first, tid, { externalId: "a" }), { source: "webhook", ghlContactId: ghl, emit });
    // The CRM later knows the same person under another email; no tid on this one.
    await recordOptIn(db(), s.account.id, optIn(second, null, { externalId: "b" }), { source: "ghl", ghlContactId: ghl, emit });
    await recordPurchase(
      db(),
      s.account.id,
      { email: second, tid: null, externalId: "pay-1", amountCents: 9700, currency: "USD", refundedCents: null, subscriptionId: null, occurredAt: new Date(now.getTime() + 3_600_000) },
      { source: "ghl", ghlContactId: ghl, emit },
    );
    expect(await liveContacts(s.account.id)).toHaveLength(1);

    await runAttribution(db(), s.account.id, now);
    const [paid] = await db().select().from(purchases).where(eq(purchases.externalId, "pay-1"));
    expect(paid).toMatchObject({ attributionMethod: "email", attributedVideoId: "VIDEO_A", attributedReplyId: reply.id });

    const reports = await rebuildReports(db(), s.account.id, new Date(now.getTime() + 86_400_000));
    expect(reports!.all_time.totals).toMatchObject({ comments: 1, commenters: 1, newCommenters: 1, clicks: 1, subscribers: 1, buyers: 1, revenueCents: 9700 });
  });

  it("keeps two accounts apart even for the same email", async () => {
    const a = await setup();
    const b = await setup();
    const email = mail("both");
    await recordOptIn(db(), a.account.id, optIn(email, null), { source: "webhook", emit });
    await recordOptIn(db(), b.account.id, optIn(email, null), { source: "webhook", emit });
    const [ca] = await liveContacts(a.account.id);
    const [cb] = await liveContacts(b.account.id);
    expect(ca!.id).not.toBe(cb!.id);
  });

  it("makes one Contact when many workers resolve the same new person at once", async () => {
    const s = await setup();
    const author = `UC${randomUUID()}`;
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        resolveContact(db(), { accountId: s.account.id, keys: { youtubeChannel: author }, event: "comment", createdVia: "comment", source: `w${i}`, at: now }),
      ),
    );
    expect(new Set(results.map((r) => r.contactId)).size).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(await liveContacts(s.account.id)).toHaveLength(1);

    const email = mail("race");
    await Promise.all(
      Array.from({ length: 6 }, (_, i) => recordOptIn(db(), s.account.id, optIn(email, null, { externalId: `f${i}` }), { source: "webhook", emit })),
    );
    expect(await liveContacts(s.account.id)).toHaveLength(2);
  });

  it("builds Contacts for rows older than the model, once, without duplicates", async () => {
    const s = await setup();
    const author = `UC${randomUUID()}`;
    // Legacy rows: two replies by one commenter (comments still stored), one reply whose comment is gone.
    const legacy = async (authorId: string | null, video: string) => {
      const [c] = await db()
        .insert(comments)
        .values({ channelId: s.channel.id, youtubeCommentId: `c-${randomUUID()}`, youtubeVideoId: video, authorChannelId: authorId, text: "guide", publishedAt: now, fetchedAt: now })
        .returning();
      const [r] = await db()
        .insert(replies)
        .values({ accountId: s.account.id, channelId: s.channel.id, commentId: c!.id, campaignId: s.campaign.id, youtubeVideoId: video, keyword: "guide", intent: "warm", language: "en", body: "x {link}", draftSource: "template" })
        .returning();
      return r!;
    };
    const r1 = await legacy(author, "V1");
    const r2 = await legacy(author, "V2");
    const [gone] = await db()
      .insert(replies)
      .values({ accountId: s.account.id, channelId: s.channel.id, campaignId: s.campaign.id, youtubeVideoId: "V3", keyword: "guide", intent: "warm", language: "en", body: "x {link}", draftSource: "template" })
      .returning();
    const [link] = await db()
      .insert(links)
      .values({ accountId: s.account.id, kind: "reply", slug: newTid().slice(0, 7), host: "go.vidrev.app", campaignId: s.campaign.id, replyId: gone!.id, youtubeVideoId: "V3", keyword: "guide", destinationUrl: "https://coach.com/optin" })
      .returning();
    const tid = newTid();
    await db().insert(clicks).values({ tid, accountId: s.account.id, linkId: link!.id, replyId: gone!.id, campaignId: s.campaign.id, youtubeVideoId: "V3", keyword: "guide", host: "go.vidrev.app", userAgentClass: "desktop", isBot: false });
    const email = mail("legacy");
    await db().insert(subscribers).values({ accountId: s.account.id, emailNorm: email, source: "webhook", dedupeKey: tid, tid, replyId: gone!.id, campaignId: s.campaign.id, youtubeVideoId: "V3", keyword: "guide", occurredAt: now });
    await db().insert(purchases).values({ accountId: s.account.id, source: "webhook", externalId: "legacy-1", emailNorm: email, amountCents: 100, currency: "USD", occurredAt: now });

    const done = await backfillContacts(db(), s.account.id);
    expect(done).toMatchObject({ replies: 3, subscribers: 1, purchases: 1 });

    const [a, b, c] = await Promise.all([r1, r2, gone!].map(async (r) => (await db().select().from(replies).where(eq(replies.id, r.id)))[0]!.contactId));
    expect(a).toBe(b);
    expect(c).not.toBe(a);
    // The opt-in and the purchase of the person behind reply 3 share its Contact.
    const [sub] = await db().select().from(subscribers).where(eq(subscribers.emailNorm, email));
    const [buy] = await db().select().from(purchases).where(eq(purchases.externalId, "legacy-1"));
    expect(sub!.contactId).toBe(c);
    expect(buy!.contactId).toBe(c);
    expect((await db().select().from(clicks).where(eq(clicks.tid, tid)))[0]!.contactId).toBe(c);
    expect(await liveContacts(s.account.id)).toHaveLength(2);

    // Idempotent: nothing left to do, nothing duplicated.
    expect(await backfillContacts(db(), s.account.id)).toEqual({ replies: 0, clicks: 0, subscribers: 0, purchases: 0 });
    expect(await liveContacts(s.account.id)).toHaveLength(2);
  });
});
