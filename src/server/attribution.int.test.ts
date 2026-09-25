import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/db/client";
import { accounts, campaigns, channels, clicks, links, purchases } from "@/db/schema";
import { newTid } from "@/lib/links";
import { runMigrations } from "@/scripts/migrate";
import { queueReportRefreshes, refreshAccountReports } from "@/worker/reports";
import { createAccountWithUser } from "./accounts";
import { claimReportDirty, dirtyAccounts, markReportDirty, runAttribution } from "./attribution";
import { emitEventSafely } from "./integrations/events";
import { recordOptIn, recordPurchase } from "./integrations/inbound";

const hasDb = Boolean(process.env.DATABASE_URL);
const db = () => getDb();
const noEmit = async () => {};
const DAY = 86_400_000;

async function setup() {
  const { account } = await createAccountWithUser(db(), { email: `attr-${randomUUID()}@example.com`, planCode: "standard_monthly" });
  const [channel] = await db().insert(channels).values({ accountId: account.id, youtubeChannelId: `UC${randomUUID()}`, status: "connected" }).returning();
  const [campaign] = await db()
    .insert(campaigns)
    .values({ accountId: account.id, channelId: channel!.id, name: "Guide", keyword: "guide", intent: "hot", destinationUrl: "https://coach.com/optin" })
    .returning();
  const [link] = await db()
    .insert(links)
    .values({ accountId: account.id, kind: "static", slug: newTid().slice(0, 7), host: "go.vidrev.app", campaignId: campaign!.id, youtubeVideoId: "vidA", keyword: "guide", intent: "hot", destinationUrl: "https://coach.com/optin" })
    .returning();
  const click = async (at: Date, video = "vidA") => {
    const tid = newTid();
    await db()
      .insert(clicks)
      .values({ tid, accountId: account.id, linkId: link!.id, campaignId: campaign!.id, youtubeVideoId: video, keyword: "guide", host: "go.vidrev.app", userAgentClass: "mobile", isBot: false, createdAt: at });
    return tid;
  };
  return { account, campaign: campaign!, click };
}

const purchaseInput = (over: Partial<Parameters<typeof recordPurchase>[2]> = {}) => ({
  email: "buyer@example.com",
  tid: null,
  externalId: randomUUID(),
  amountCents: 9700,
  currency: "USD",
  refundedCents: null,
  subscriptionId: null,
  occurredAt: new Date(),
  ...over,
});

async function purchaseRow(id: string) {
  const [row] = await db().select().from(purchases).where(eq(purchases.id, id));
  return row!;
}

describe.skipIf(!hasDb)("attribution (integration)", () => {
  beforeAll(async () => {
    await runMigrations(process.env.DATABASE_URL!);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("attributes by the opt-in of the same email and links the subscriber", async () => {
    const { account, campaign, click } = await setup();
    const now = new Date();
    const tid = await click(new Date(now.getTime() - 3 * DAY));
    const optIn = await recordOptIn(
      db(),
      account.id,
      { email: "buyer@example.com", name: null, tid, externalId: null, consentMarketing: null, occurredAt: new Date(now.getTime() - 2 * DAY) },
      { source: "webhook", emit: noEmit },
    );
    const bought = await recordPurchase(db(), account.id, purchaseInput({ occurredAt: now }), { source: "webhook", emit: noEmit });
    await runAttribution(db(), account.id, now);
    const row = await purchaseRow(bought.id);
    expect(row).toMatchObject({
      canonicalPurchaseId: bought.id,
      netCents: 9700,
      attributionMethod: "email",
      attributedSubscriberId: optIn.id,
      attributedCampaignId: campaign.id,
      attributedVideoId: "vidA",
      attributedKeyword: "guide",
      attributedIntent: "hot",
    });
    expect(row.attributionComputedAt).not.toBeNull();
  });

  it("links a GHL copy of a webhook sale to one canonical purchase and follows renewals", async () => {
    const { account, click } = await setup();
    const first = new Date(Date.now() - 400 * DAY);
    const tid = await click(new Date(first.getTime() - DAY), "vidB");
    const hook = await recordPurchase(db(), account.id, purchaseInput({ tid, email: null, externalId: "order-1", subscriptionId: "sub_9", occurredAt: first }), { source: "webhook", emit: noEmit });
    const ghl = await recordPurchase(db(), account.id, purchaseInput({ externalId: "tx-1", tid, subscriptionId: "sub_9", occurredAt: new Date(first.getTime() + 60_000) }), { source: "ghl", emit: noEmit });
    const renewal = await recordPurchase(db(), account.id, purchaseInput({ externalId: "tx-2", subscriptionId: "sub_9", occurredAt: new Date() }), { source: "ghl", emit: noEmit });
    await runAttribution(db(), account.id);
    expect(await purchaseRow(ghl.id)).toMatchObject({ canonicalPurchaseId: ghl.id, netCents: 9700, attributionMethod: "tid", attributedVideoId: "vidB" });
    expect(await purchaseRow(hook.id)).toMatchObject({ canonicalPurchaseId: ghl.id, netCents: 0, attributionMethod: "tid" });
    expect(await purchaseRow(renewal.id)).toMatchObject({ canonicalPurchaseId: renewal.id, netCents: 9700, attributionMethod: "subscription", attributedVideoId: "vidB" });

    // A refund reported later lowers the counted revenue and marks the account.
    await db().update(accounts).set({ reportDirtyAt: null }).where(eq(accounts.id, account.id));
    await recordPurchase(db(), account.id, purchaseInput({ externalId: "tx-2", refundedCents: 9700, subscriptionId: "sub_9" }), { source: "ghl", emit: noEmit });
    expect(await dirtyAccounts(db(), 10_000)).toContain(account.id);
    const second = await runAttribution(db(), account.id);
    expect(second.changed).toBe(1);
    expect((await purchaseRow(renewal.id)).netCents).toBe(0);
    expect((await runAttribution(db(), account.id)).changed).toBe(0);
  });

  it("leaves a purchase without any touch unattributed but counted", async () => {
    const { account } = await setup();
    const bought = await recordPurchase(db(), account.id, purchaseInput({ email: "stranger@example.com" }), { source: "webhook", emit: noEmit });
    await runAttribution(db(), account.id);
    expect(await purchaseRow(bought.id)).toMatchObject({ canonicalPurchaseId: bought.id, netCents: 9700, attributionMethod: null, attributedVideoId: null });
  });

  it("marks an account dirty on any event, and a refresh clears it", async () => {
    const { account } = await setup();
    await db().update(accounts).set({ reportDirtyAt: null }).where(eq(accounts.id, account.id));
    await emitEventSafely(db(), { accountId: account.id, event: "link_clicked" }, async () => {});
    expect(await dirtyAccounts(db(), 10_000)).toContain(account.id);

    const queued: string[] = [];
    await queueReportRefreshes({ db: db(), enqueue: async (_queue, data) => void queued.push((data as { accountId: string }).accountId) });
    expect(queued).toContain(account.id);

    await refreshAccountReports({ db: db(), enqueue: async () => {} }, account.id);
    expect(await dirtyAccounts(db(), 10_000)).not.toContain(account.id);
    const [row] = await db().select().from(accounts).where(eq(accounts.id, account.id));
    expect(row!.reportsComputedAt).not.toBeNull();

    // Data that arrives during a run keeps the flag for the next run.
    const started = new Date();
    await markReportDirty(db(), account.id, new Date(started.getTime() + 1000));
    await claimReportDirty(db(), account.id, started);
    expect(await dirtyAccounts(db(), 10_000)).toContain(account.id);
  });
});
