import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/db/client";
import { runMigrations } from "@/scripts/migrate";
import { accounts, channels, integrations } from "@/db/schema";
import { createAccountWithUser } from "./accounts";
import { completeOnboardingIfReady, onboardingState } from "./onboarding";

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("onboarding (integration)", () => {
  beforeAll(async () => {
    await runMigrations(process.env.DATABASE_URL!);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("walks the four steps in order and stamps onboarded_at only at the end", async () => {
    const db = getDb();
    const { account } = await createAccountWithUser(db, { email: `onb-${randomUUID()}@example.com`, planCode: "standard_monthly" });
    const step = async () => (await onboardingState(db, account.id)).current;

    expect(await step()).toBe("youtube");
    // A purchase source and target set early do not skip the channel.
    await db.update(accounts).set({ purchaseSource: "ghl", defaultTargetUrl: "https://example.com/guide" }).where(eq(accounts.id, account.id));
    expect(await step()).toBe("youtube");

    await db.insert(channels).values({ accountId: account.id, youtubeChannelId: `UC${randomUUID()}`, status: "connected" });
    expect(await step()).toBe("crm");
    expect(await completeOnboardingIfReady(db, account.id)).toBe(false);

    await db.insert(integrations).values({ accountId: account.id, type: "ghl", status: "active" });
    expect(await step()).toBeNull();
    expect(await completeOnboardingIfReady(db, account.id)).toBe(true);
    const [row] = await db.select({ onboardedAt: accounts.onboardedAt }).from(accounts).where(eq(accounts.id, account.id));
    expect(row?.onboardedAt).toBeInstanceOf(Date);
  });

  it("needs an active Stripe connection when Stripe is the purchase source", async () => {
    const db = getDb();
    const { account } = await createAccountWithUser(db, { email: `onb-${randomUUID()}@example.com`, planCode: "standard_monthly" });
    await db.insert(channels).values({ accountId: account.id, youtubeChannelId: `UC${randomUUID()}`, status: "connected" });
    await db.insert(integrations).values({ accountId: account.id, type: "ghl", status: "active" });
    await db.update(accounts).set({ purchaseSource: "stripe" }).where(eq(accounts.id, account.id));
    expect((await onboardingState(db, account.id)).current).toBe("purchases");
    await db.insert(integrations).values({ accountId: account.id, type: "stripe", status: "active" });
    expect((await onboardingState(db, account.id)).current).toBe("target");
  });
});
