import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/db/client";
import { contacts, crmProspectBackups, integrations } from "@/db/schema";
import { runMigrations } from "@/scripts/migrate";
import type { GhlContact } from "@/server/ghl/api";
import { DAY, rig } from "./beast.fixture";
import { createProspect, PROSPECT_TTL_MS, proveOwnProspect, restoreProspect, sweepProspects } from "./prospects";

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
    expect(backup?.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 30 * DAY + 23 * 3_600_000 + 60_000);

    expect(await restoreProspect(r.deps, backup!.id)).toBe("restored");
    const restored = [...r.crm.contacts.values()].at(-1)!;
    expect(restored.tags).not.toContain("vidrev-prospect");
    expect(restored.customFields ?? []).toEqual([]);

    // Backups are dropped after their 23 hours, in any mode.
    await sweepProspects(r.later(32), "off");
    expect(await db().select().from(crmProspectBackups).where(eq(crmProspectBackups.id, backup!.id))).toEqual([]);
  });

  it("never deletes a contact that fails a proof, and leaves opted-in people alone", async () => {
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
    expect(r.crm.deletes).toEqual([]);
    for (const c of [withEmail, otherField, noTag]) expect((await r.prospectOf(c.contactId))?.status).toBe("kept");
    expect((await r.prospectOf(optedIn.contactId))?.status).toBe("opted_in");
    // Kept rows are never looked at again.
    await sweepProspects(r.later(31), "on");
    expect(r.crm.deletes).toEqual([]);
  });

  it("retries a failing CRM for the grace days, then closes our row", async () => {
    const r = await rig();
    const c = await r.comment();
    await createProspect(r.deps, c.replyId);
    await db().update(integrations).set({ status: "error" }).where(eq(integrations.id, r.integrationId));
    // The sweep sees every account in this database: count this row only.
    expect((await sweepProspects(r.later(30), "on")).retry).toBeGreaterThanOrEqual(1);
    expect((await r.prospectOf(c.contactId))?.deleteAttempts).toBe(1);
    await sweepProspects(r.later(33), "on");
    expect((await r.prospectOf(c.contactId))?.status).toBe("abandoned");
  });
});
