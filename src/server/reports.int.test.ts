import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/db/client";
import { accounts, campaigns, channels, clicks, links, replies } from "@/db/schema";
import { newTid } from "@/lib/links";
import { runMigrations } from "@/scripts/migrate";
import { refreshAccountReports } from "@/worker/reports";
import { createAccountWithUser } from "./accounts";
import { recordOptIn, recordPurchase } from "./integrations/inbound";
import { readSnapshots } from "./reports";

const hasDb = Boolean(process.env.DATABASE_URL);
const db = () => getDb();
const noEmit = async () => {};
const deps = () => ({ db: db(), enqueue: async () => {} });

async function setup() {
  const { account } = await createAccountWithUser(db(), { email: `rep-${randomUUID()}@example.com`, planCode: "founding" });
  const [channel] = await db().insert(channels).values({ accountId: account.id, youtubeChannelId: `UC${randomUUID()}`, status: "connected" }).returning();
  const [campaign] = await db()
    .insert(campaigns)
    .values({ accountId: account.id, channelId: channel!.id, name: "Guide", keyword: "guide", intent: "hot", destinationUrl: "https://coach.com/optin" })
    .returning();
  const now = new Date();
  const [reply] = await db()
    .insert(replies)
    .values({
      accountId: account.id,
      channelId: channel!.id,
      campaignId: campaign!.id,
      youtubeVideoId: "vidA",
      keyword: "guide",
      intent: "hot",
      language: "en",
      body: "Here you go: {link}",
      draftSource: "ai",
      status: "sent",
      createdAt: new Date(now.getTime() - 30 * 60_000),
      sentAt: now,
    })
    .returning();
  const [link] = await db()
    .insert(links)
    .values({ accountId: account.id, kind: "reply", slug: newTid().slice(0, 7), host: "go.vidrev.app", campaignId: campaign!.id, replyId: reply!.id, youtubeVideoId: "vidA", keyword: "guide", intent: "hot", destinationUrl: "https://coach.com/optin" })
    .returning();
  const tids: string[] = [];
  for (const isBot of [false, false, true]) {
    const tid = newTid();
    tids.push(tid);
    await db()
      .insert(clicks)
      .values({ tid, accountId: account.id, linkId: link!.id, replyId: reply!.id, campaignId: campaign!.id, youtubeVideoId: "vidA", keyword: "guide", host: "go.vidrev.app", userAgentClass: isBot ? "bot" : "mobile", isBot });
  }
  return { account, reply: reply!, tid: tids[0]! };
}

describe.skipIf(!hasDb)("report snapshots (integration)", () => {
  beforeAll(async () => {
    await runMigrations(process.env.DATABASE_URL!);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("builds every period from replies, clicks, opt-ins and attributed purchases", async () => {
    const { account, tid } = await setup();
    await recordOptIn(db(), account.id, { email: "ann@example.com", name: null, tid, externalId: null, consentMarketing: null, occurredAt: new Date() }, { source: "webhook", emit: noEmit });
    await recordPurchase(
      db(),
      account.id,
      { email: "ann@example.com", tid: null, externalId: "o-1", amountCents: 9700, currency: "USD", refundedCents: null, subscriptionId: null, occurredAt: new Date() },
      { source: "webhook", emit: noEmit },
    );
    await refreshAccountReports(deps(), account.id);
    const { reports, computedAt } = await readSnapshots(db(), account.id);
    expect(computedAt).not.toBeNull();
    expect(Object.keys(reports).sort()).toEqual(["all_time", "last_30", "last_7", "last_90", "this_month"]);
    expect(reports.this_month!.totals).toMatchObject({ comments: 1, replies: 1, clicks: 2, subscribers: 1, buyers: 1, revenueCents: 9700 });
    expect(reports.all_time!.byTemplate[0]).toMatchObject({ key: "ai", clicks: 2, buyers: 1 });
    expect(reports.all_time!.byReplyTime.find((b) => b.key === "under_1h")).toMatchObject({ replies: 1, clicks: 2, revenueCents: 9700 });
  });

  it("follows the currency of the connected CRM unless the creator chose one", async () => {
    const { account } = await setup();
    await recordPurchase(
      db(),
      account.id,
      { email: "eu@example.com", tid: null, externalId: "tx-eur", amountCents: 5000, currency: "EUR", refundedCents: null, subscriptionId: null, occurredAt: new Date() },
      { source: "ghl", emit: noEmit },
    );
    await refreshAccountReports(deps(), account.id);
    let [row] = await db().select().from(accounts).where(eq(accounts.id, account.id));
    expect(row).toMatchObject({ reportingCurrency: "EUR", reportingCurrencySource: "source" });

    await db().update(accounts).set({ reportingCurrency: "USD", reportingCurrencySource: "creator", reportTimezone: "Asia/Singapore" }).where(eq(accounts.id, account.id));
    await refreshAccountReports(deps(), account.id);
    [row] = await db().select().from(accounts).where(eq(accounts.id, account.id));
    expect(row!.reportingCurrency).toBe("USD");
    const { reports } = await readSnapshots(db(), account.id);
    expect(reports.this_month!.currency).toBe("USD");
    expect(reports.this_month!.totals.clicks).toBe(2);
  });

  it("sends each milestone once and the weekly summary on Monday", async () => {
    const { account } = await setup();
    const sent: { to: string; subject: string }[] = [];
    // A Monday, 10:00 UTC; the clicks of setup() are inside the last 7 days.
    const monday = new Date(Date.UTC(2026, 8, 28, 10));
    const now = new Date() > monday ? new Date(monday.getTime() + Math.ceil((Date.now() - monday.getTime()) / (7 * 86_400_000)) * 7 * 86_400_000) : monday;
    const notifyDeps = {
      db: db(),
      now: () => now,
      enqueue: async () => {},
      notify: { appBaseUrl: "https://app.vidrev.app", productName: "vidrev", sendEmail: async (job: { to: string; subject: string }) => void sent.push(job) },
    };
    await refreshAccountReports(notifyDeps, account.id);
    expect(sent.map((m) => m.subject)).toEqual([expect.stringMatching(/clicked the link/), expect.stringMatching(/^This week your comments made \$0\.00/)]);
    const [row] = await db().select().from(accounts).where(eq(accounts.id, account.id));
    expect(row!.milestones.first_click).toBeDefined();
    expect(row!.weeklyEmailSentAt).not.toBeNull();

    sent.length = 0;
    await refreshAccountReports(notifyDeps, account.id);
    expect(sent).toEqual([]);
  });
});
