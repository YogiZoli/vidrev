import type { Db } from "@/db/client";
import { appBaseUrl } from "@/lib/env";
import type { FetchLike } from "@/server/google/oauth";
import { GHL_API, GHL_VERSION } from "@/server/ghl/api";
import { getAudit } from "./service";

// Audit leads into the owner's own GoHighLevel Sub-account (STATUS open issue,
// owner request 2026-09-29). Runs in the worker after the full report was
// requested: the visitor typed their email for it, so this is the lead. The
// Sub-account holds the tags and contact fields created on 2026-09-28.
// No comment text or other YouTube data leaves the app: only the channel the
// visitor typed, the audit link and two numbers of their own result.

export const AUDIT_LEAD_TAGS = ["vidrev-lead-audit", "vidrev-temperature-warm-lead"] as const;
export const CONSENT_TAG = "vidrev-consent-marketing";

export interface OwnerCrm {
  apiKey: string;
  locationId: string;
}

export interface AuditLead {
  email: string;
  tags: string[];
  customFields: { key: string; field_value: string | number }[];
}

export async function buildAuditLead(db: Db, auditId: string): Promise<AuditLead | null> {
  const audit = await getAudit(db, auditId);
  if (!audit?.requesterEmail || !audit.result) return null;
  const tags: string[] = [...AUDIT_LEAD_TAGS];
  if (audit.consentMarketing) tags.push(CONSENT_TAG);
  const customFields: AuditLead["customFields"] = [
    { key: "audit_channel", field_value: audit.channelInput },
    {
      key: "audit_report_url",
      field_value: `${appBaseUrl()}/where-i-lose-money-on-youtube/${audit.id}`,
    },
    {
      key: "audit_unanswered_buying_signals",
      field_value: audit.result.buying.unanswered,
    },
  ];
  if (audit.result.score.value !== null)
    customFields.push({
      key: "audit_score",
      field_value: audit.result.score.value,
    });
  return { email: audit.requesterEmail, tags, customFields };
}

async function call<T>(fetchImpl: FetchLike, crm: OwnerCrm, path: string, body: unknown): Promise<T> {
  const response = await fetchImpl(`${GHL_API}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${crm.apiKey}`,
      version: GHL_VERSION,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`owner_crm_http_${response.status}`);
  return (await response.json()) as T;
}

// Upsert by email, then add the tags on their own call: an upsert with tags
// replaces the contact's existing tags, a tag call only adds.
export async function pushAuditLead(deps: { db: Db; fetch: FetchLike; crm: OwnerCrm | null }, auditId: string): Promise<"sent" | "skipped"> {
  if (!deps.crm) return "skipped";
  const lead = await buildAuditLead(deps.db, auditId);
  if (!lead) return "skipped";
  const upserted = await call<{ contact?: { id?: string } }>(deps.fetch, deps.crm, "/contacts/upsert", {
    locationId: deps.crm.locationId,
    email: lead.email,
    source: "vidrev audit",
    customFields: lead.customFields,
  });
  const contactId = upserted.contact?.id;
  if (!contactId) throw new Error("owner_crm_no_contact_id");
  await call(deps.fetch, deps.crm, `/contacts/${encodeURIComponent(contactId)}/tags`, { tags: lead.tags });
  return "sent";
}
