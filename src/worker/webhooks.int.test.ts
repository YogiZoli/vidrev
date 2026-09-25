import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/db/client";
import { integrations, outboundDeliveries } from "@/db/schema";
import { verifySignature } from "@/lib/webhooks";
import { runMigrations } from "@/scripts/migrate";
import { createAccountWithUser } from "@/server/accounts";
import { emitEvent } from "@/server/integrations/events";
import type { PostFn } from "@/server/integrations/http-post";
import {
  createEndpoint,
  listEndpoints,
  pruneDeliveries,
  queuePing,
  removeEndpoint,
  revealEndpoint,
  rotateSecret,
  setEndpointEnabled,
} from "@/server/integrations/outbound";
import { deliver, deliverDue, type WebhookDeps } from "./webhooks";

const hasDb = Boolean(process.env.DATABASE_URL);
const KEY = Buffer.alloc(32, 7).toString("base64");
const T0 = new Date("2026-09-25T10:00:00Z");

interface Call {
  url: string;
  body: string;
  headers: Record<string, string>;
}

function fakePost(respond: (call: Call) => number | Error) {
  const calls: Call[] = [];
  const post: PostFn = async (url, body, headers) => {
    const call = { url, body, headers };
    calls.push(call);
    const result = respond(call);
    if (result instanceof Error) throw result;
    return { status: result };
  };
  return { calls, post };
}

function depsAt(post: PostFn, now: Date): WebhookDeps {
  return { db: getDb(), encryptionKey: KEY, post, now: () => now };
}

async function account() {
  return (await createAccountWithUser(getDb(), { email: `wh-${randomUUID()}@example.com`, planCode: "standard_monthly" })).account;
}

async function endpoint(accountId: string, events: string[] = []) {
  const result = await createEndpoint(getDb(), KEY, { accountId, url: "https://hooks.example.com/c2c", events });
  if (!result.ok) throw new Error(result.error);
  return result.id;
}

async function delivery(id: string) {
  const [row] = await getDb().select().from(outboundDeliveries).where(eq(outboundDeliveries.id, id));
  return row!;
}

describe.skipIf(!hasDb)("outbound webhooks (integration)", () => {
  beforeAll(async () => {
    await runMigrations(process.env.DATABASE_URL!);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("creates endpoints: public https only, encrypted secret, at most five", async () => {
    const a = await account();
    for (const url of ["http://hooks.example.com/x", "https://localhost/x", "https://10.0.0.5/x", "https://169.254.169.254/x"]) {
      expect(await createEndpoint(getDb(), KEY, { accountId: a.id, url })).toMatchObject({ ok: false });
    }
    const id = await endpoint(a.id);
    const [row] = await getDb().select().from(integrations).where(eq(integrations.id, id));
    expect(row!.configEnc).toMatch(/^v1:/);
    expect(row!.configEnc).not.toContain("hooks.example.com");
    const revealed = await revealEndpoint(getDb(), KEY, a.id, id);
    expect(revealed?.url).toBe("https://hooks.example.com/c2c");
    expect(revealed?.secret).toMatch(/^whsec_/);
    for (let i = 0; i < 4; i += 1) await endpoint(a.id);
    expect(await createEndpoint(getDb(), KEY, { accountId: a.id, url: "https://hooks.example.com/six" })).toMatchObject({ ok: false });
    expect((await listEndpoints(getDb(), a.id)).length).toBe(5);
    // Another account cannot read it.
    const b = await account();
    expect(await revealEndpoint(getDb(), KEY, b.id, id)).toBeNull();
  });

  it("emits only to active endpoints that subscribe, once per event id", async () => {
    const a = await account();
    const all = await endpoint(a.id);
    const optInOnly = await endpoint(a.id, ["opt_in"]);
    const off = await endpoint(a.id);
    await setEndpointEnabled(getDb(), a.id, off, false);

    const click = await emitEvent(getDb(), { accountId: a.id, event: "link_clicked", context: { keyword: "guide", tid: "t1" } });
    expect(click).toHaveLength(1);
    expect((await delivery(click[0]!)).integrationId).toBe(all);

    const eventId = randomUUID();
    const optIn = await emitEvent(getDb(), { accountId: a.id, event: "opt_in", eventId, context: { email: "x@y.com" } });
    expect(optIn).toHaveLength(2);
    const targets = (await Promise.all(optIn.map(delivery))).map((d) => d.integrationId).sort();
    expect(targets).toEqual([all, optInOnly].sort());
    // The same event id never creates a second row.
    expect(await emitEvent(getDb(), { accountId: a.id, event: "opt_in", eventId, context: { email: "x@y.com" } })).toHaveLength(0);
    // No endpoints, no rows.
    expect(await emitEvent(getDb(), { accountId: (await account()).id, event: "opt_in" })).toEqual([]);
  });

  it("delivers a signed body with event headers", async () => {
    const a = await account();
    await endpoint(a.id);
    const [id] = await emitEvent(getDb(), { accountId: a.id, event: "purchase", occurredAt: T0, context: { email: "b@y.com", amountCents: 9700, currency: "USD", keyword: "guide", buyer: true } });
    const fake = fakePost(() => 200);
    const now = new Date(Date.now() + 1000);
    await deliver(depsAt(fake.post, now), id!);

    expect(fake.calls).toHaveLength(1);
    const call = fake.calls[0]!;
    const row = await delivery(id!);
    const secret = (await revealEndpoint(getDb(), KEY, a.id, row.integrationId))!.secret;
    expect(verifySignature(call.body, call.headers["x-signature"], secret)).toBe(true);
    expect(call.headers["x-event-id"]).toBe(row.eventId);
    expect(call.headers["x-event-name"]).toBe("purchase");
    expect(JSON.parse(call.body)).toMatchObject({ event: "purchase", id: row.eventId, email: "b@y.com", amount_cents: 9700, tags: ["c2c", "c2c_kw_guide", "c2c_buyer"] });
    expect(row).toMatchObject({ status: "delivered", attempt: 1, responseStatus: 200 });

    // A delivered row is never sent again.
    await deliver(depsAt(fake.post, now), id!);
    expect(fake.calls).toHaveLength(1);
  });

  it("retries with backoff and gives up after 24 hours", async () => {
    const a = await account();
    await endpoint(a.id);
    const [id] = await emitEvent(getDb(), { accountId: a.id, event: "opt_in", occurredAt: T0, context: { email: "c@y.com" } });
    // Created at "T0": pin created_at so the 24 hour window is deterministic.
    await getDb().update(outboundDeliveries).set({ createdAt: T0, nextAttemptAt: T0 }).where(eq(outboundDeliveries.id, id!));
    const fake = fakePost(() => 500);

    let now = T0;
    const delays: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const before = await delivery(id!);
      if (before.status !== "pending") break;
      now = before.nextAttemptAt;
      await deliver(depsAt(fake.post, now), id!);
      const after = await delivery(id!);
      if (after.status === "pending") delays.push((after.nextAttemptAt.getTime() - now.getTime()) / 1000);
    }
    expect(delays).toEqual([60, 300, 900, 3600, 10_800, 21_600, 43_200]);
    const dead = await delivery(id!);
    expect(dead).toMatchObject({ status: "dead", attempt: 8, lastError: "http_500" });
    expect(dead.updatedAt.getTime()).toBeLessThan(T0.getTime() + 24 * 3_600_000 + 60_000);
    expect(fake.calls).toHaveLength(8);
  });

  it("does not attempt before the next attempt is due", async () => {
    const a = await account();
    await endpoint(a.id);
    const [id] = await emitEvent(getDb(), { accountId: a.id, event: "opt_in", context: {} });
    await getDb().update(outboundDeliveries).set({ createdAt: T0, nextAttemptAt: T0 }).where(eq(outboundDeliveries.id, id!));
    const fake = fakePost(() => new Error("connect ECONNREFUSED"));
    await deliver(depsAt(fake.post, T0), id!);
    expect(await delivery(id!)).toMatchObject({ attempt: 1, status: "pending", lastError: "connect ECONNREFUSED" });
    await deliver(depsAt(fake.post, new Date(T0.getTime() + 30_000)), id!);
    expect(fake.calls).toHaveLength(1);
    await deliver(depsAt(fake.post, new Date(T0.getTime() + 61_000)), id!);
    expect(fake.calls).toHaveLength(2);
  });

  it("two parallel jobs post the event once", async () => {
    const a = await account();
    await endpoint(a.id);
    const [id] = await emitEvent(getDb(), { accountId: a.id, event: "opt_in", context: {} });
    const fake = fakePost(() => 200);
    const now = new Date(Date.now() + 1000);
    await Promise.all([deliver(depsAt(fake.post, now), id!), deliver(depsAt(fake.post, now), id!)]);
    expect(fake.calls).toHaveLength(1);
  });

  it("410 disables the endpoint; a disabled or removed endpoint drops its events", async () => {
    const a = await account();
    const gone = await endpoint(a.id);
    const [id] = await emitEvent(getDb(), { accountId: a.id, event: "opt_in", context: {} });
    await deliver(depsAt(fakePost(() => 410).post, new Date(Date.now() + 1000)), id!);
    const [row] = await getDb().select().from(integrations).where(eq(integrations.id, gone));
    expect(row).toMatchObject({ status: "disabled", statusReason: "endpoint_gone" });

    const b = await account();
    const removed = await endpoint(b.id);
    const [pending] = await emitEvent(getDb(), { accountId: b.id, event: "opt_in", context: {} });
    expect(await removeEndpoint(getDb(), b.id, removed)).toBe(true);
    const [gone2] = await getDb().select().from(integrations).where(eq(integrations.id, removed));
    expect(gone2).toMatchObject({ status: "removed", configEnc: null });
    expect(await delivery(pending!)).toMatchObject({ status: "dead", lastError: "endpoint_removed" });
    expect(await removeEndpoint(getDb(), a.id, removed)).toBe(false);
  });

  it("deliverDue sends what is due and nothing else", async () => {
    const a = await account();
    await endpoint(a.id);
    const [due] = await emitEvent(getDb(), { accountId: a.id, event: "opt_in", context: {} });
    const [later] = await emitEvent(getDb(), { accountId: a.id, event: "link_clicked", context: {} });
    const now = new Date(Date.now() + 5000);
    await getDb().update(outboundDeliveries).set({ nextAttemptAt: new Date(now.getTime() + 3_600_000) }).where(eq(outboundDeliveries.id, later!));
    const fake = fakePost(() => 204);
    await deliverDue(depsAt(fake.post, now));
    expect((await delivery(due!)).status).toBe("delivered");
    expect((await delivery(later!)).status).toBe("pending");
  });

  it("rotates the secret, sends a test ping, prunes old logs", async () => {
    const a = await account();
    const id = await endpoint(a.id);
    const before = (await revealEndpoint(getDb(), KEY, a.id, id))!.secret;
    expect(await rotateSecret(getDb(), KEY, a.id, id)).toBe(true);
    expect((await revealEndpoint(getDb(), KEY, a.id, id))!.secret).not.toBe(before);

    const ping = await queuePing(getDb(), a.id, id);
    const fake = fakePost(() => 200);
    await deliver(depsAt(fake.post, new Date(Date.now() + 1000)), ping!);
    expect(JSON.parse(fake.calls[0]!.body)).toMatchObject({ event: "ping", account_id: a.id });
    expect(await queuePing(getDb(), (await account()).id, id)).toBeNull();

    const old = new Date(Date.now() - 31 * 86_400_000);
    await getDb().update(outboundDeliveries).set({ updatedAt: old }).where(eq(outboundDeliveries.id, ping!));
    expect(await pruneDeliveries(getDb())).toBeGreaterThanOrEqual(1);
    const rows = await getDb().select().from(outboundDeliveries).where(eq(outboundDeliveries.id, ping!));
    expect(rows).toHaveLength(0);
  });
});
