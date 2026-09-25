import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/db/client";
import { audits } from "@/db/schema";
import type { AuditExamples, AuditResult } from "@/lib/audit/result";
import { runMigrations } from "@/scripts/migrate";
import { REPORTS_PER_EMAIL_PER_DAY, requestReport } from "./report";

const hasDb = Boolean(process.env.DATABASE_URL);
const db = () => getDb();

const result: AuditResult = {
  version: 1,
  sample: { videos: 2, comments: 6, commentsOffVideos: 0 },
  questions: { total: 2, answered: 0, unanswered: 2, unknown: 0 },
  buying: { total: 1, answered: 0, unanswered: 1, unknown: 0 },
  keywords: [],
  links: { videosChecked: 2, videosWithLink: 1, linksFound: 1, linksChecked: 1, measured: 0, ownDomain: 1 },
  stack: { segment: "other", detected: [] },
  score: { value: 20, factors: [] },
  findings: [],
};
const examples: AuditExamples = { channelTitle: "Coach", videos: [], questions: [], buying: [], links: [] };

async function doneAudit(over: Partial<typeof audits.$inferInsert> = {}) {
  const [row] = await db()
    .insert(audits)
    .values({ channelKey: `handle:${randomUUID()}`, channelInput: "@coach", status: "done", result, examples, fetchedAt: new Date(), ...over })
    .returning();
  return row!;
}

const email = () => `visitor-${randomUUID()}@example.com`;

describe.skipIf(!hasDb)("audit report request (integration)", () => {
  beforeAll(async () => {
    await runMigrations(process.env.DATABASE_URL!);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("records the email and the marketing answer, and builds the report once", async () => {
    const audit = await doneAudit();
    const to = email();
    const first = await requestReport(db(), { auditId: audit.id, email: ` ${to.toUpperCase()} `, marketing: false });
    expect(first).toMatchObject({ ok: true, alreadySent: false });
    if (!first.ok || !first.email) throw new Error("expected an email");
    expect(first.email.to).toBe(to);
    const [row] = await db().select().from(audits).where(eq(audits.id, audit.id));
    expect(row).toMatchObject({ requesterEmail: to, consentMarketing: false });
    expect(row!.consentAt).not.toBeNull();
    expect(row!.reportSentAt).not.toBeNull();

    const again = await requestReport(db(), { auditId: audit.id, email: to, marketing: true });
    expect(again).toEqual({ ok: true, alreadySent: true, email: null });
    const [unchanged] = await db().select().from(audits).where(eq(audits.id, audit.id));
    expect(unchanged!.consentMarketing).toBe(false);
  });

  it("stores a ticked marketing box as consent", async () => {
    const audit = await doneAudit();
    await requestReport(db(), { auditId: audit.id, email: email(), marketing: true });
    const [row] = await db().select().from(audits).where(eq(audits.id, audit.id));
    expect(row!.consentMarketing).toBe(true);
  });

  it("refuses bad emails, unfinished audits and expired details", async () => {
    const audit = await doneAudit();
    expect(await requestReport(db(), { auditId: audit.id, email: "not-an-email", marketing: false })).toEqual({ ok: false, error: "invalid_email" });
    const running = await doneAudit({ status: "running", result: null, examples: null });
    expect(await requestReport(db(), { auditId: running.id, email: email(), marketing: false })).toEqual({ ok: false, error: "not_ready" });
    const scrubbed = await doneAudit({ examples: null, apiDataScrubbedAt: new Date() });
    expect(await requestReport(db(), { auditId: scrubbed.id, email: email(), marketing: false })).toEqual({ ok: false, error: "expired" });
    expect(await requestReport(db(), { auditId: randomUUID(), email: email(), marketing: false })).toEqual({ ok: false, error: "not_found" });
    expect(await requestReport(db(), { auditId: "nonsense", email: email(), marketing: false })).toEqual({ ok: false, error: "not_found" });
  });

  it("limits the reports one address can receive in a day", async () => {
    const to = email();
    for (let i = 0; i < REPORTS_PER_EMAIL_PER_DAY; i += 1) {
      const audit = await doneAudit();
      expect(await requestReport(db(), { auditId: audit.id, email: to, marketing: false })).toMatchObject({ ok: true, alreadySent: false });
    }
    const audit = await doneAudit();
    expect(await requestReport(db(), { auditId: audit.id, email: to, marketing: false })).toEqual({ ok: false, error: "limit" });
  });
});
