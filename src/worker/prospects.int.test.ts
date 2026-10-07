import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/db/client";
import { contacts, crmProspectBackups, crmProspects, integrations } from "@/db/schema";
import { runMigrations } from "@/scripts/migrate";
import type { GhlContact } from "@/server/ghl/api";
import { rig } from "./beast.fixture";
import { cleanupProspects, createProspect, mergeProspects, MAX_AGE_MS, PROSPECT_TTL_MS, proveOwnProspect, requeueLostProspects, restoreProspect, STALE_CREATING_MS, sweepProspects } from "./prospects";

const hasDb = Boolean(process.env.DATABASE_URL);
const db = () => getDb();

describe("proveOwnProspect", () => {
  const prospect = { id: "P-1" };
  const ours: GhlContact = { id: "C", tags: ["vidrev", "vidrev-prospect"], customFields: [{ id: "PF", value: "P-1" }] };

  it("accepts only a contact with our id in the field, the tag and no email or phone", () => {
    expect(proveOwnProspect(ours, prospect, "PF").ok).toBe(true);
    expect(proveOwnProspect(null, prospect, "PF")).toEqual({ ok: "gone" });
    expect(proveOwnProspect({ ...ours, email: "lead@x.com" }, prospect, "PF")).toEqual({ ok: false, reason: "has an email" });
    expect(proveOwnProspect({ ...ours, phone: "+3612345" }, prospect, "PF")).toEqual({ ok: false, reason: "has a phone" });
    expect(proveOwnProspect({ ...ours, customFields: [{ id: "PF", value: "P-2" }] }, prospect, "PF").ok).toBe(false);
    expect(proveOwnProspect({ ...ours, customFields: [] }, prospect, "PF").ok).toBe(false);
    expect(proveOwnProspect({ ...ours, tags: ["vidrev"] }, prospect, "PF").ok).toBe(false);
    expect(proveOwnProspect(ours, prospect, null).ok).toBe(false);
  });
});

describe.skipIf(!hasDb)("Beast Mode prospects (integration)", () => {
  beforeAll(async () => {
    await runMigrations(process.env.DATABASE_URL!);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("creates one tagged contact per commenter, with our row id in the field, and adds tags on the next comment", async () => {
    const r = await rig();
    const first = await r.comment();
    expect(await createProspect(r.deps, first.replyId)).toBe("created");
    const prospect = await r.prospectOf(first.contactId);
    expect(prospect?.status).toBe("created");
    const contact = r.crm.contacts.get(prospect!.ghlContactId!)!;
    expect(contact.name).toBe("Jane Viewer");
    expect(contact.tags).toEqual(expect.arrayContaining(["vidrev-prospect", "vidrev-keyword-guide", "vidrev-temperature-cold-lead", "vidrev-video-dQw4w9WgXcQ"]));
    expect(contact.customFields).toEqual([{ id: "PF", value: prospect!.id }]);
    expect(prospect!.expiresAt.getTime() - Date.now()).toBeGreaterThan(PROSPECT_TTL_MS - 60_000);

    // Same person again, and the same job twice: never a second contact.
    const second = await r.comment(first.contactId);
    expect(await createProspect(r.deps, second.replyId)).toBe("tagged");
    expect(await createProspect(r.deps, first.replyId)).toBe("tagged");
    expect(r.crm.creates).toBe(1);
  });

  it("does nothing in Clean Mode, off the allowlist, or for a commenter who already opted in", async () => {
    const clean = await rig({ mode: "clean" });
    expect(await createProspect(clean.deps, (await clean.comment()).replyId)).toBe("not_beast");
    const off = await rig();
    expect(await createProspect({ ...off.deps, beastAllowlist: "someone@else.com" }, (await off.comment()).replyId)).toBe("not_beast");
    const lead = await rig();
    const c = await lead.comment();
    await db().update(contacts).set({ stage: "subscriber" }).where(eq(contacts.id, c.contactId));
    expect(await createProspect(lead.deps, c.replyId)).toBe("opted_in");
    expect(clean.crm.creates + off.crm.creates + lead.crm.creates).toBe(0);
  });

  it("releases the claim on a clear refusal, but never retries a create that may have happened", async () => {
    const r = await rig();
    const c = await r.comment();
    r.crm.failCreate = "422";
    await expect(createProspect(r.deps, c.replyId)).rejects.toThrow();
    expect(await r.prospectOf(c.contactId)).toBeUndefined();

    r.crm.failCreate = "timeout";
    expect(await createProspect(r.deps, c.replyId)).toBe("unconfirmed");
    r.crm.failCreate = "none";
    expect(await createProspect(r.deps, c.replyId)).toBe("pending");
    expect(r.crm.creates).toBe(1);
  });

  it("dry run only lists; off touches nothing; on deletes with a 23 hour backup that can be restored", async () => {
    const r = await rig();
    const c = await r.comment();
    await createProspect(r.deps, c.replyId);
    const id = (await r.prospectOf(c.contactId))!.ghlContactId!;

    expect((await sweepProspects(r.deps, "on")).deleted).toBe(0); // not due yet
    expect((await sweepProspects(r.later(30), "off")).wouldDelete).toBe(0);
    expect((await sweepProspects(r.later(30), "dry_run")).wouldDelete).toBeGreaterThanOrEqual(1);
    expect(r.crm.contacts.has(id)).toBe(true);
    expect((await r.prospectOf(c.contactId))?.wouldDeleteAt).toBeInstanceOf(Date);

    await sweepProspects(r.later(30), "on");
    expect(r.crm.deletes).toEqual([id]);
    const prospect = await r.prospectOf(c.contactId);
    expect(prospect?.status).toBe("deleted");
    const [backup] = await db().select().from(crmProspectBackups).where(eq(crmProspectBackups.prospectId, prospect!.id));
    // Never past day 29 of the prospect, even when deleted late.
    expect(backup?.expiresAt.getTime()).toBeLessThanOrEqual(prospect!.createdAt.getTime() + MAX_AGE_MS);

    expect(await restoreProspect(r.deps, backup!.id)).toBe("restored");
    const restored = [...r.crm.contacts.values()].at(-1)!;
    expect(restored.tags).not.toContain("vidrev-prospect");
    expect(restored.customFields ?? []).toEqual([]);

    // Backups are dropped after their 23 hours, in any mode.
    await sweepProspects(r.later(32), "off");
    expect(await db().select().from(crmProspectBackups).where(eq(crmProspectBackups.id, backup!.id))).toEqual([]);
  });

  it("never deletes a contact that fails a proof, and merges opted-in people instead of expiring them", async () => {
    const r = await rig();
    const withEmail = await r.comment();
    const otherField = await r.comment();
    const noTag = await r.comment();
    const optedIn = await r.comment();
    for (const c of [withEmail, otherField, noTag, optedIn]) await createProspect(r.deps, c.replyId);
    const contactOf = async (c: { contactId: string }) => r.crm.contacts.get((await r.prospectOf(c.contactId))!.ghlContactId!)!;
    (await contactOf(withEmail)).email = "real.lead@example.com";
    (await contactOf(otherField)).customFields = [{ id: "PF", value: randomUUID() }];
    (await contactOf(noTag)).tags = ["vidrev"];
    await db().update(contacts).set({ stage: "subscriber" }).where(eq(contacts.id, optedIn.contactId));

    await sweepProspects(r.later(30), "on");
    // Only the opted-in prospect goes: through the merge, with both proofs.
    const optedInId = (await r.prospectOf(optedIn.contactId))!.ghlContactId;
    expect(r.crm.deletes).toEqual([optedInId]);
    for (const c of [withEmail, otherField, noTag]) expect((await r.prospectOf(c.contactId))?.status).toBe("kept");
    expect((await r.prospectOf(optedIn.contactId))?.status).toBe("opted_in");
    // Kept rows are never looked at again.
    await sweepProspects(r.later(31), "on");
    expect(r.crm.deletes).toEqual([optedInId]);
  });

  it("on opt-in copies tags and a summary to the email contact, then deletes the prospect (only when BEAST_DELETE is on)", async () => {
    const r = await rig();
    const c = await r.comment();
    await createProspect(r.deps, c.replyId);
    const prospect = (await r.prospectOf(c.contactId))!;
    r.crm.contacts.set("EMAIL-1", { id: "EMAIL-1", email: "lead@example.com", tags: ["from-form"] });
    const deps = { ...r.deps, providerId: "PROV-1" };

    // Dry run: copied, not deleted, and the copy is not repeated.
    expect(await mergeProspects(deps, { integrationId: r.integrationId, contactId: c.contactId, emailContactId: "EMAIL-1" }, "dry_run")).toMatchObject({ merged: 1, waiting: 1 });
    expect(r.crm.contacts.get("EMAIL-1")!.tags).toEqual(expect.arrayContaining(["from-form", "vidrev-keyword-guide"]));
    expect(r.crm.contacts.get("EMAIL-1")!.tags).not.toContain("vidrev-prospect");
    expect(r.crm.inbound.at(-1)!.message).toContain("Opted in from YouTube comments");
    expect(r.crm.inbound.at(-1)!.message).not.toContain("GUIDE please");
    expect(r.crm.contacts.has(prospect.ghlContactId!)).toBe(true);

    expect(await mergeProspects(deps, { integrationId: r.integrationId, contactId: c.contactId, emailContactId: "EMAIL-1" }, "on")).toMatchObject({ merged: 0, deleted: 1 });
    expect(r.crm.deletes).toEqual([prospect.ghlContactId]);
    expect(r.crm.contacts.has("EMAIL-1")).toBe(true);
    expect((await r.prospectOf(c.contactId))?.status).toBe("opted_in");
    expect(r.crm.conversations.filter((v) => v.contactId === "EMAIL-1")).toHaveLength(1);
  });

  it("deletes our prospects before a disconnect, never a contact with an email, and not with the brake on", async () => {
    const r = await rig();
    const a = await r.comment();
    const b = await r.comment();
    await createProspect(r.deps, a.replyId);
    await createProspect(r.deps, b.replyId);
    const bContact = r.crm.contacts.get((await r.prospectOf(b.contactId))!.ghlContactId!)!;
    bContact.email = "someone@example.com";
    expect(await cleanupProspects(r.deps, r.integrationId, "off")).toEqual({ deleted: 0, kept: 0 });
    expect(await cleanupProspects(r.deps, r.integrationId, "dry_run")).toEqual({ deleted: 1, kept: 1 });
    expect(r.crm.contacts.has(bContact.id)).toBe(true);
    expect((await r.prospectOf(a.contactId))?.status).toBe("deleted");
  });

  it("retries a failing CRM for the grace days, then closes our row", async () => {
    const r = await rig();
    const c = await r.comment();
    await createProspect(r.deps, c.replyId);
    await db().update(integrations).set({ status: "error" }).where(eq(integrations.id, r.integrationId));
    // The sweep sees every account in this database: count this row only.
    expect((await sweepProspects(r.later(28.5), "on")).retry).toBeGreaterThanOrEqual(1);
    expect((await r.prospectOf(c.contactId))?.deleteAttempts).toBe(1);
    await sweepProspects(r.later(29.01), "on");
    expect((await r.prospectOf(c.contactId))?.status).toBe("abandoned");
  });

  it("a claim left in creating by a stopped worker: later comments come back, then it is closed as unconfirmed, never created twice", async () => {
    const r = await rig();
    const first = await r.comment();
    // The worker stopped right after claiming: the row stays "creating".
    const [stale] = await db()
      .insert(crmProspects)
      .values({ accountId: r.account.id, contactId: first.contactId, integrationId: r.integrationId, expiresAt: new Date(Date.now() + PROSPECT_TTL_MS) })
      .returning();
    const queued: unknown[] = [];
    const deps = { ...r.deps, enqueue: async (queue: string, data: unknown, options?: unknown) => void queued.push({ queue, data, options }) };
    const second = await r.comment(first.contactId);
    expect(await createProspect(deps, second.replyId)).toBe("pending");
    expect(queued).toEqual([{ queue: "ghl.prospect", data: { replyId: second.replyId }, options: { startAfter: 60 } }]);

    const later = { ...deps, now: () => new Date(stale!.createdAt.getTime() + STALE_CREATING_MS + 1000) };
    expect(await createProspect(later, second.replyId)).toBe("unconfirmed");
    expect((await r.prospectOf(first.contactId))?.status).toBe("unconfirmed");
    expect(await createProspect(later, second.replyId)).toBe("pending");
    expect(r.crm.creates).toBe(0);
  });

  it("29 day rule: the delete starts on day 28 and an unconfirmed create is found in the CRM and deleted by day 29", async () => {
    const r = await rig();
    const c = await r.comment();
    r.crm.failCreate = "timeout";
    expect(await createProspect(r.deps, c.replyId)).toBe("unconfirmed");
    r.crm.failCreate = "none";
    const made = [...r.crm.contacts.keys()].at(-1)!;
    expect((await r.prospectOf(c.contactId))?.ghlContactId).toBeNull();

    await sweepProspects(r.later(27.9), "on");
    expect(r.crm.contacts.has(made)).toBe(true);
    await sweepProspects(r.later(28.01), "on");
    expect(r.crm.deletes).toContain(made);
    expect(await r.prospectOf(c.contactId)).toMatchObject({ status: "deleted", ghlContactId: made });
  });

  it("an unconfirmed create that never reached the CRM is closed without a delete", async () => {
    const r = await rig();
    const c = await r.comment();
    r.crm.failCreate = "timeout";
    await createProspect(r.deps, c.replyId);
    r.crm.contacts.clear();
    await sweepProspects(r.later(28.01), "on");
    expect((await r.prospectOf(c.contactId))?.status).toBe("abandoned");
    expect(r.crm.deletes).toEqual([]);
  });

  it("cleanup before disconnect also finds and deletes unconfirmed creates", async () => {
    const r = await rig();
    const c = await r.comment();
    r.crm.failCreate = "timeout";
    await createProspect(r.deps, c.replyId);
    const made = [...r.crm.contacts.keys()].at(-1)!;
    expect(await cleanupProspects(r.deps, r.integrationId, "on")).toEqual({ deleted: 1, kept: 0 });
    expect(r.crm.deletes).toEqual([made]);
  });

  it("queues a Beast Mode reply again when its prospect job was lost, once per person, and not in Clean Mode", async () => {
    const r = await rig();
    const lost = await r.comment();
    const done = await r.comment();
    await createProspect(r.deps, done.replyId);
    const clean = await rig({ mode: "clean" });
    const cleanReply = await clean.comment();
    const queued: { data: unknown; options: unknown }[] = [];
    const deps = { ...r.deps, enqueue: async (_q: string, data: unknown, options?: unknown) => void queued.push({ data, options }), now: () => new Date(Date.now() + 20 * 60_000) };

    await requeueLostProspects(deps);
    const ids = queued.map((q) => (q.data as { replyId: string }).replyId);
    expect(ids).toContain(lost.replyId);
    expect(ids).not.toContain(done.replyId);
    expect(ids).not.toContain(cleanReply.replyId);
    expect(queued.find((q) => (q.data as { replyId: string }).replyId === lost.replyId)?.options).toEqual({ singletonKey: `prospect:${lost.replyId}` });

    // Too fresh (the first job may still run) or older than 2 days: left alone.
    queued.length = 0;
    await requeueLostProspects({ ...deps, now: () => new Date() });
    expect(queued.map((q) => (q.data as { replyId: string }).replyId)).not.toContain(lost.replyId);
    await requeueLostProspects({ ...deps, now: () => new Date(Date.now() + 3 * 86_400_000) });
    expect(queued.map((q) => (q.data as { replyId: string }).replyId)).not.toContain(lost.replyId);
  });
});
