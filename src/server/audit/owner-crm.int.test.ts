import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/db/client";
import { audits } from "@/db/schema";
import type { AuditExamples, AuditResult } from "@/lib/audit/result";
import { runMigrations } from "@/scripts/migrate";
import { pushAuditLead } from "./owner-crm";

const hasDb = Boolean(process.env.DATABASE_URL);
const db = () => getDb();

const result: AuditResult = {
  version: 1,
  sample: { videos: 5, comments: 74, commentsOffVideos: 0 },
  questions: { total: 52, answered: 16, unanswered: 36, unknown: 0 },
  buying: { total: 31, answered: 4, unanswered: 27, unknown: 0 },
  keywords: [],
  links: {
    videosChecked: 5,
    videosWithLink: 3,
    linksFound: 4,
    linksChecked: 4,
    measured: 1,
    ownDomain: 2,
  },
  stack: { segment: "ghl", detected: [] },
  score: { value: 30, factors: [] },
  findings: [],
};
const examples: AuditExamples = {
  channelTitle: "Coach",
  videos: [],
  questions: [],
  buying: [],
  links: [],
};
const crm = { apiKey: "pit-test", locationId: "LOC123" };

async function audit(over: Partial<typeof audits.$inferInsert> = {}) {
  const [row] = await db()
    .insert(audits)
    .values({
      channelKey: `handle:${randomUUID()}`,
      channelInput: "@coach",
      status: "done",
      result,
      examples,
      fetchedAt: new Date(),
      ...over,
    })
    .returning();
  return row!;
}

function fakeGhl() {
  const calls: { url: string; body: Record<string, unknown>; auth: string }[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url: String(url),
      body: JSON.parse(String(init?.body)),
      auth: headers.get("authorization") ?? "",
    });
    const payload = String(url).endsWith("/contacts/upsert") ? { contact: { id: "c-1" } } : { tags: [] };
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { calls, fetch: fetch as typeof globalThis.fetch };
}

describe.skipIf(!hasDb)("audit lead into the owner's GoHighLevel (integration)", () => {
  beforeAll(async () => {
    await runMigrations(process.env.DATABASE_URL!);
  });
  afterAll(async () => {
    await closeDb();
  });

  it("upserts the requester with the audit fields, then adds the tags (consent tag only with consent)", async () => {
    const row = await audit({
      requesterEmail: "lead@example.com",
      consentMarketing: true,
      consentAt: new Date(),
      reportSentAt: new Date(),
    });
    const ghl = fakeGhl();
    expect(await pushAuditLead({ db: db(), fetch: ghl.fetch, crm }, row.id)).toBe("sent");
    expect(ghl.calls).toHaveLength(2);
    const [upsert, tags] = ghl.calls;
    expect(upsert!.url).toMatch(/\/contacts\/upsert$/);
    expect(upsert!.auth).toBe("Bearer pit-test");
    expect(upsert!.body).toMatchObject({
      locationId: "LOC123",
      email: "lead@example.com",
    });
    expect(upsert!.body.tags).toBeUndefined();
    expect(upsert!.body.customFields).toEqual(
      expect.arrayContaining([
        { key: "audit_channel", field_value: "@coach" },
        { key: "audit_unanswered_buying_signals", field_value: 27 },
        { key: "audit_score", field_value: 30 },
        expect.objectContaining({ key: "audit_report_url" }),
      ]),
    );
    expect(tags!.url).toMatch(/\/contacts\/c-1\/tags$/);
    expect(tags!.body.tags).toEqual(["vidrev-lead-audit", "temp-warm", "vidrev-consent-marketing"]);

    const noConsent = await audit({
      requesterEmail: "quiet@example.com",
      consentMarketing: false,
      reportSentAt: new Date(),
    });
    const again = fakeGhl();
    await pushAuditLead({ db: db(), fetch: again.fetch, crm }, noConsent.id);
    expect(again.calls[1]!.body.tags).toEqual(["vidrev-lead-audit", "temp-warm"]);
  });

  it("skips without a configured CRM or without a requester", async () => {
    const row = await audit();
    const ghl = fakeGhl();
    expect(await pushAuditLead({ db: db(), fetch: ghl.fetch, crm: null }, row.id)).toBe("skipped");
    expect(await pushAuditLead({ db: db(), fetch: ghl.fetch, crm }, row.id)).toBe("skipped");
    expect(ghl.calls).toHaveLength(0);
  });

  it("fails loudly on an HTTP error so the job retries", async () => {
    const row = await audit({
      requesterEmail: "err@example.com",
      reportSentAt: new Date(),
    });
    const fetch = (async () => new Response("no", { status: 401 })) as typeof globalThis.fetch;
    await expect(pushAuditLead({ db: db(), fetch, crm }, row.id)).rejects.toThrow("owner_crm_http_401");
  });
});
