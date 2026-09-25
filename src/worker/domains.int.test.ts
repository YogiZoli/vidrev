import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/db/client";
import { customDomains } from "@/db/schema";
import { runMigrations } from "@/scripts/migrate";
import { createAccountWithUser } from "@/server/accounts";
import { addDomain, removeDomain, restartDomainCheck } from "@/server/domains/service";
import { linkHostFor } from "@/server/links";
import { checkDomain, type DomainDeps, queueDomainChecks, removeDomainHostname } from "./domains";

const hasDb = Boolean(process.env.DATABASE_URL);
const TARGET = "customers.vidrev.app";
const reserved = new Set(["vidrev.app"]);

interface FakeState {
  cname: string | null;
  cf: { status: string; ssl: string };
  created: number;
  deleted: string[];
}

function fake(state: FakeState, now: Date) {
  const sent: { queue: string; data: unknown }[] = [];
  const deps: DomainDeps = {
    db: getDb(),
    fetch: async (url, init) => {
      if (url.startsWith("https://cloudflare-dns.com/")) {
        const type = new URL(url).searchParams.get("type");
        if (type === "NS") return Response.json({ Status: 0, Answer: [{ name: "x", type: 2, data: "ns51.domaincontrol.com." }] });
        return Response.json({ Status: 0, Answer: state.cname ? [{ name: "x", type: 5, data: `${state.cname}.` }] : [] });
      }
      const method = init?.method ?? "GET";
      if (method === "POST") state.created += 1;
      if (method === "DELETE") {
        state.deleted.push(url.split("/").at(-1)!);
        return Response.json({ success: true, result: { id: "cf-1" } });
      }
      return Response.json({ success: true, result: { id: "cf-1", hostname: "h", status: state.cf.status, ssl: { status: state.cf.ssl } } });
    },
    cloudflare: { apiToken: "t", zoneId: "z" },
    cnameTarget: TARGET,
    domainConnect: null,
    appBaseUrl: "https://app.vidrev.app",
    enqueue: async (queue, data) => {
      sent.push({ queue, data });
    },
    now: () => now,
  };
  return { deps, sent };
}

async function account() {
  return (await createAccountWithUser(getDb(), { email: `dom-${randomUUID()}@example.com`, planCode: "standard_monthly" })).account;
}

async function row(id: string) {
  const [r] = await getDb().select().from(customDomains).where(eq(customDomains.id, id));
  return r!;
}

describe.skipIf(!hasDb)("custom link domains (integration)", () => {
  beforeAll(async () => {
    await runMigrations(process.env.DATABASE_URL!);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("validates input: subdomain only, not ours, one per account, one account per host", async () => {
    const a = await account();
    const b = await account();
    const host = `go.${randomUUID().slice(0, 8)}.com`;
    expect(await addDomain(getDb(), a.id, "coach.com", reserved)).toMatchObject({ ok: false });
    expect(await addDomain(getDb(), a.id, "go.vidrev.app", reserved)).toMatchObject({ ok: false });
    expect(await addDomain(getDb(), a.id, "not a host", reserved)).toMatchObject({ ok: false });
    expect(await addDomain(getDb(), a.id, `https://${host.toUpperCase()}/`, reserved)).toMatchObject({ ok: true });
    expect(await addDomain(getDb(), a.id, `link.${host.slice(3)}`, reserved)).toMatchObject({ ok: false, error: "Remove your current link domain first." });
    expect(await addDomain(getDb(), b.id, host, reserved)).toMatchObject({ ok: false, error: "This domain is already used by another account." });
  });

  it("goes live when DNS and Cloudflare are ready, emails the creator, and new links use it", async () => {
    const a = await account();
    const host = `go.${randomUUID().slice(0, 8)}.com`;
    const added = await addDomain(getDb(), a.id, host, reserved);
    if (!added.ok) throw new Error(added.error);
    const state: FakeState = { cname: null, cf: { status: "pending", ssl: "pending_validation" }, created: 0, deleted: [] };
    const now = new Date();

    await checkDomain(fake(state, now).deps, added.id);
    expect(await row(added.id)).toMatchObject({ status: "pending", dnsOk: false, dnsProvider: "godaddy", cloudflareHostnameId: "cf-1", checks: 1 });
    expect(await linkHostFor(getDb(), a.id, "go.vidrev.app")).toBe("go.vidrev.app");

    state.cname = "elsewhere.example.net";
    await checkDomain(fake(state, now).deps, added.id);
    expect((await row(added.id)).lastError).toBe(`The record points to elsewhere.example.net, not ${TARGET}.`);

    state.cname = TARGET;
    state.cf = { status: "active", ssl: "active" };
    const live = fake(state, now);
    await checkDomain(live.deps, added.id);
    expect(await row(added.id)).toMatchObject({ status: "active", dnsOk: true, lastError: null, verifiedAt: now });
    expect(state.created).toBe(1);
    expect(live.sent).toHaveLength(1);
    expect(live.sent[0]).toMatchObject({ queue: "email.send", data: { subject: `${host} is live` } });
    expect(await linkHostFor(getDb(), a.id, "go.vidrev.app")).toBe(host);

    // Broken later: back to pending, new links use the fallback again.
    state.cf = { status: "moved", ssl: "active" };
    await checkDomain(fake(state, now).deps, added.id);
    expect((await row(added.id)).status).toBe("pending");
    expect(await linkHostFor(getDb(), a.id, "go.vidrev.app")).toBe("go.vidrev.app");
  });

  it("queues due checks, gives up after 14 days, restarts on Check now, removes the Cloudflare hostname", async () => {
    const a = await account();
    const added = await addDomain(getDb(), a.id, `go.${randomUUID().slice(0, 8)}.com`, reserved);
    if (!added.ok) throw new Error(added.error);
    const state: FakeState = { cname: null, cf: { status: "pending", ssl: "pending_validation" }, created: 0, deleted: [] };

    const soon = fake(state, new Date());
    await queueDomainChecks(soon.deps);
    expect(soon.sent).toContainEqual({ queue: "domain.check", data: { domainId: added.id } });

    const later = fake(state, new Date(Date.now() + 15 * 86_400_000));
    await queueDomainChecks(later.deps);
    expect((await row(added.id)).status).toBe("failed");

    expect(await restartDomainCheck(getDb(), a.id, added.id)).toBe(true);
    expect((await row(added.id)).status).toBe("pending");

    await checkDomain(fake(state, new Date()).deps, added.id);
    expect(await removeDomain(getDb(), randomUUID(), added.id)).toBe(false);
    expect(await removeDomain(getDb(), a.id, added.id)).toBe(true);
    await removeDomainHostname(fake(state, new Date()).deps, added.id);
    expect(state.deleted).toEqual(["cf-1"]);
    expect(await row(added.id)).toMatchObject({ status: "removed", cloudflareHostnameId: null });
    // The host is free again, and the account can add a new one.
    expect(await addDomain(getDb(), a.id, `link.${randomUUID().slice(0, 8)}.com`, reserved)).toMatchObject({ ok: true });
  });

  it("refuses new domains once the spend cap is reached", async () => {
    const a = await account();
    expect(await addDomain(getDb(), a.id, `go.${randomUUID().slice(0, 8)}.com`, reserved, 0)).toMatchObject({ ok: false, capReached: true });
    expect(await addDomain(getDb(), a.id, `go.${randomUUID().slice(0, 8)}.com`, reserved, 1_000_000)).toMatchObject({ ok: true });
  });

  it("records a clear error when Cloudflare is not configured", async () => {
    const a = await account();
    const added = await addDomain(getDb(), a.id, `go.${randomUUID().slice(0, 8)}.com`, reserved);
    if (!added.ok) throw new Error(added.error);
    const { deps } = fake({ cname: null, cf: { status: "pending", ssl: "x" }, created: 0, deleted: [] }, new Date());
    await checkDomain({ ...deps, cloudflare: null }, added.id);
    expect((await row(added.id)).lastError).toBe("Custom domains are not configured on the server yet.");
  });
});
