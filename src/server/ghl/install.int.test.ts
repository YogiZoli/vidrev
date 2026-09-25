import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/db/client";
import { accounts, ghlInstalls, integrations } from "@/db/schema";
import { runMigrations } from "@/scripts/migrate";
import { createAccountWithUser } from "@/server/accounts";
import { connectGhl } from "./connect";
import { claimInstall, deleteExpiredInstalls, hasPendingInstall, INSTALL_TTL_MS, receiveMarketplaceInstall } from "./install";
import { readGhlConfig } from "./tokens";

const hasDb = Boolean(process.env.DATABASE_URL);
const key = randomBytes(32).toString("base64");
const db = () => getDb();

const grant = (locationId: string, extra: Record<string, unknown> = {}) => ({
  access_token: "SECRET-ACCESS",
  refresh_token: "SECRET-REFRESH",
  expires_in: 86_399,
  userType: "Location",
  locationId,
  ...extra,
});

async function newAccount() {
  return (await createAccountWithUser(db(), { email: `mp-${randomUUID()}@example.com`, planCode: "standard_monthly" })).account;
}

describe.skipIf(!hasDb)("Marketplace install (integration)", () => {
  beforeAll(async () => {
    await runMigrations(process.env.DATABASE_URL!);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("refuses an agency grant and never stores it", async () => {
    expect(await receiveMarketplaceInstall(db(), key, grant("L", { userType: "Company" }))).toEqual({ kind: "error", error: "not_location" });
    expect(await receiveMarketplaceInstall(db(), key, { ...grant("L"), locationId: undefined })).toEqual({ kind: "error", error: "not_location" });
  });

  it("holds a new location sealed until a signed-in account claims it, once", async () => {
    const location = `LOC-${randomUUID()}`;
    const account = await newAccount();
    const install = await receiveMarketplaceInstall(db(), key, grant(location));
    if (install.kind !== "pending") throw new Error(install.kind);

    const [row] = await db().select().from(ghlInstalls).where(eq(ghlInstalls.locationId, location));
    expect(row!.configEnc).not.toContain("SECRET");
    expect(row!.claimHash).not.toBe(install.claimToken);
    expect(await hasPendingInstall(db(), install.claimToken)).toBe(true);
    expect(await hasPendingInstall(db(), "wrong-token")).toBe(false);

    expect(await claimInstall(db(), key, account.id, "wrong-token")).toEqual({ ok: false, error: "expired" });
    const claimed = await claimInstall(db(), key, account.id, install.claimToken);
    if (!claimed.ok) throw new Error(claimed.error);
    const [integration] = await db().select().from(integrations).where(eq(integrations.id, claimed.id));
    expect(integration).toMatchObject({ accountId: account.id, type: "ghl", externalRef: location, status: "active" });
    expect(readGhlConfig(integration!.configEnc!, key)).toMatchObject({ accessToken: "SECRET-ACCESS", refreshToken: "SECRET-REFRESH", locationId: location });

    // The grant is used up: the same token cannot connect anything again.
    expect(await hasPendingInstall(db(), install.claimToken)).toBe(false);
    expect(await claimInstall(db(), key, (await newAccount()).id, install.claimToken)).toEqual({ ok: false, error: "expired" });
  });

  it("keeps the remaining lifetime of the access token when it is claimed later", async () => {
    const location = `LOC-${randomUUID()}`;
    const account = await newAccount();
    const t0 = new Date("2026-09-26T10:00:00Z");
    const install = await receiveMarketplaceInstall(db(), key, grant(location), t0);
    if (install.kind !== "pending") throw new Error(install.kind);
    const later = new Date(t0.getTime() + 3_600_000);
    const claimed = await claimInstall(db(), key, account.id, install.claimToken, later);
    if (!claimed.ok) throw new Error(claimed.error);
    const [integration] = await db().select().from(integrations).where(eq(integrations.id, claimed.id));
    const config = readGhlConfig(integration!.configEnc!, key);
    // 86,399 s from t0, not from the claim.
    expect(new Date(config.expiresAt).getTime()).toBe(t0.getTime() + 86_399_000);
  });

  it("expires after a day and the retention job removes what is left", async () => {
    const location = `LOC-${randomUUID()}`;
    const t0 = new Date("2026-09-20T10:00:00Z");
    const install = await receiveMarketplaceInstall(db(), key, grant(location), t0);
    if (install.kind !== "pending") throw new Error(install.kind);
    const dayAfter = new Date(t0.getTime() + INSTALL_TTL_MS + 1000);
    expect(await hasPendingInstall(db(), install.claimToken, new Date(t0.getTime() + 3_600_000))).toBe(true);
    expect(await hasPendingInstall(db(), install.claimToken, dayAfter)).toBe(false);
    expect(await claimInstall(db(), key, (await newAccount()).id, install.claimToken, dayAfter)).toEqual({ ok: false, error: "expired" });
    expect(await deleteExpiredInstalls(db(), new Date())).toBeGreaterThanOrEqual(1);
    expect(await db().select().from(ghlInstalls).where(eq(ghlInstalls.locationId, location))).toHaveLength(0);
  });

  it("the latest install of a location replaces the earlier waiting one", async () => {
    const location = `LOC-${randomUUID()}`;
    const first = await receiveMarketplaceInstall(db(), key, grant(location));
    const second = await receiveMarketplaceInstall(db(), key, grant(location));
    if (first.kind !== "pending" || second.kind !== "pending") throw new Error("expected pending");
    expect(await hasPendingInstall(db(), first.claimToken)).toBe(false);
    expect(await hasPendingInstall(db(), second.claimToken)).toBe(true);
    expect(await db().select().from(ghlInstalls).where(eq(ghlInstalls.locationId, location))).toHaveLength(1);
  });

  it("a reinstall of a location that already belongs to an active account refreshes it there and never moves it", async () => {
    const location = `LOC-${randomUUID()}`;
    const owner = await newAccount();
    const stranger = await newAccount();
    const first = await connectGhl(db(), key, owner.id, grant(location));
    if (!first.ok) throw new Error(first.error);

    const again = await receiveMarketplaceInstall(db(), key, grant(location, { access_token: "NEW-ACCESS" }));
    expect(again).toEqual({ kind: "reconnected", accountId: owner.id, integrationId: first.id });
    const [integration] = await db().select().from(integrations).where(eq(integrations.id, first.id));
    expect(readGhlConfig(integration!.configEnc!, key).accessToken).toBe("NEW-ACCESS");
    expect(await db().select().from(ghlInstalls).where(eq(ghlInstalls.locationId, location))).toHaveLength(0);

    // A suspended owner: the grant waits, and another account cannot take the location.
    await db().update(accounts).set({ status: "suspended" }).where(eq(accounts.id, owner.id));
    const waiting = await receiveMarketplaceInstall(db(), key, grant(location));
    if (waiting.kind !== "pending") throw new Error(waiting.kind);
    expect(await claimInstall(db(), key, stranger.id, waiting.claimToken)).toEqual({ ok: false, error: "location_taken" });
    // A refused claim keeps the grant for a retry.
    expect(await hasPendingInstall(db(), waiting.claimToken)).toBe(true);
  });

  it("a claim is refused while another CRM location is connected, and works after it is removed", async () => {
    const account = await newAccount();
    const existing = await connectGhl(db(), key, account.id, grant(`LOC-${randomUUID()}`));
    if (!existing.ok) throw new Error(existing.error);
    const install = await receiveMarketplaceInstall(db(), key, grant(`LOC-${randomUUID()}`));
    if (install.kind !== "pending") throw new Error(install.kind);
    expect(await claimInstall(db(), key, account.id, install.claimToken)).toEqual({ ok: false, error: "already_connected" });
    await db().update(integrations).set({ status: "removed" }).where(eq(integrations.id, existing.id));
    expect(await claimInstall(db(), key, account.id, install.claimToken)).toMatchObject({ ok: true });
  });
});
