import { normalizeEmail, isValidEmail } from "./email";
import { normalizeCurrency, toMinorUnits } from "./money";

// Payloads of the universal inbound hooks (SPEC sections 9 and 10). Form
// tools, Zapier, Make and n8n all send slightly different shapes, so common
// aliases are accepted and unknown fields are ignored.

export type Fields = Record<string, unknown>;
export type Parsed<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const TID = /^[A-Za-z0-9]{10}$/;

function text(fields: Fields, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = fields[name];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function flag(fields: Fields, ...names: string[]): boolean | null {
  for (const name of names) {
    const value = fields[name];
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const v = value.trim().toLowerCase();
      if (["true", "1", "yes", "on", "checked", "y"].includes(v)) return true;
      if (["false", "0", "no", "off", "unchecked", "n"].includes(v)) return false;
    }
  }
  return null;
}

function date(fields: Fields, now: Date, ...names: string[]): Date {
  const raw = text(fields, ...names);
  if (raw) {
    const parsed = /^\d{10,13}$/.test(raw) ? new Date(raw.length === 10 ? Number(raw) * 1000 : Number(raw)) : new Date(raw);
    // Future timestamps are clock skew or junk; the receive time is safer.
    if (!Number.isNaN(parsed.getTime()) && parsed.getTime() <= now.getTime() + 5 * 60_000) return parsed;
  }
  return now;
}

// The click id may arrive as tid, c2c_tid or, from tools that only keep UTM
// parameters, utm_content (CC-07 layer 1). A value that does not look like one
// of ours is dropped rather than rejected.
export function readTid(fields: Fields): string | null {
  for (const name of ["tid", "c2c_tid", "utm_content"]) {
    const value = text(fields, name);
    if (value && TID.test(value)) return value;
  }
  return null;
}

export interface OptInInput {
  email: string;
  name: string | null;
  tid: string | null;
  externalId: string | null;
  consentMarketing: boolean | null;
  occurredAt: Date;
}

export function parseOptIn(fields: Fields, now = new Date()): Parsed<OptInInput> {
  const email = text(fields, "email", "email_address");
  if (!email || !isValidEmail(email)) return { ok: false, errors: ["email: a valid email is required"] };
  const first = text(fields, "first_name", "firstname", "firstName");
  const last = text(fields, "last_name", "lastname", "lastName");
  return {
    ok: true,
    value: {
      email: normalizeEmail(email),
      name: (text(fields, "name", "full_name", "fullName") ?? ([first, last].filter(Boolean).join(" ") || undefined) ?? null)?.slice(0, 200) ?? null,
      tid: readTid(fields),
      externalId: text(fields, "external_id", "submission_id", "id")?.slice(0, 200) ?? null,
      consentMarketing: flag(fields, "consent_marketing", "marketing_consent", "consent"),
      occurredAt: date(fields, now, "occurred_at", "timestamp", "created_at", "submitted_at"),
    },
  };
}

export interface PurchaseInput {
  email: string | null;
  tid: string | null;
  externalId: string;
  amountCents: number | null;
  currency: string | null;
  refundedCents: number | null;
  subscriptionId: string | null;
  occurredAt: Date;
}

export function parsePurchase(fields: Fields, now = new Date()): Parsed<PurchaseInput> {
  const errors: string[] = [];
  const emailRaw = text(fields, "email", "email_address");
  if (emailRaw && !isValidEmail(emailRaw)) errors.push("email: not a valid email");
  const tid = readTid(fields);
  if (!emailRaw && !tid) errors.push("email or tid: at least one is required to attribute the purchase");
  const externalId = text(fields, "external_id", "order_id", "transaction_id", "id");
  if (!externalId) errors.push("external_id: the id of the order or payment is required (it makes retries safe)");

  const currency = normalizeCurrency(text(fields, "currency"));
  if (text(fields, "currency") && !currency) errors.push("currency: use a 3 letter code such as USD");

  let amountCents: number | null = null;
  const cents = fields.amount_cents;
  const amountRaw = fields.amount ?? fields.total ?? fields.value;
  if (cents !== undefined && cents !== null && cents !== "") {
    const n = typeof cents === "string" && /^\d+$/.test(cents.trim()) ? Number(cents) : cents;
    if (typeof n === "number" && Number.isSafeInteger(n) && n >= 0) amountCents = n;
    else errors.push("amount_cents: must be a whole non-negative number");
  } else if (amountRaw !== undefined && amountRaw !== null && amountRaw !== "") {
    if (!currency) errors.push("currency: required together with amount");
    else {
      amountCents = toMinorUnits(amountRaw, currency);
      if (amountCents === null) errors.push("amount: use a plain number such as 97 or 97.50");
    }
  }
  if (amountCents !== null && !currency) errors.push("currency: required together with an amount");

  let refundedCents: number | null = null;
  const refundCents = fields.refunded_cents;
  const refundRaw = fields.refunded_amount ?? fields.refund_amount;
  if (refundCents !== undefined && refundCents !== null && refundCents !== "") {
    const n = typeof refundCents === "string" && /^\d+$/.test(refundCents.trim()) ? Number(refundCents) : refundCents;
    if (typeof n === "number" && Number.isSafeInteger(n) && n >= 0) refundedCents = n;
    else errors.push("refunded_cents: must be a whole non-negative number");
  } else if (refundRaw !== undefined && refundRaw !== null && refundRaw !== "") {
    if (!currency) errors.push("currency: required together with refunded_amount");
    else {
      refundedCents = toMinorUnits(refundRaw, currency);
      if (refundedCents === null) errors.push("refunded_amount: use a plain number such as 97 or 97.50");
    }
  }
  // A refund event says how much was refunded; without it there is nothing to record.
  if (text(fields, "type", "event")?.toLowerCase() === "refund" && refundedCents === null) errors.push("refunded_amount: required for a refund");
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      email: emailRaw ? normalizeEmail(emailRaw) : null,
      tid,
      externalId: externalId!.slice(0, 200),
      amountCents,
      currency,
      refundedCents,
      subscriptionId: text(fields, "subscription_id", "subscription")?.slice(0, 200) ?? null,
      occurredAt: date(fields, now, "occurred_at", "timestamp", "created_at", "paid_at"),
    },
  };
}

// The raw body is needed twice: to check an optional HMAC and to parse it.
export async function readRaw(request: Request, maxBytes = 65_536): Promise<{ ok: true; raw: string } | { ok: false; status: 413; error: string }> {
  if (Number(request.headers.get("content-length") ?? 0) > maxBytes) return { ok: false, status: 413, error: "payload_too_large" };
  const raw = await request.text();
  return raw.length > maxBytes ? { ok: false, status: 413, error: "payload_too_large" } : { ok: true, raw };
}

// JSON objects and form posts (application/x-www-form-urlencoded) both work.
export function parseBody(raw: string, contentType: string | null): { ok: true; fields: Fields } | { ok: false; status: 400 | 415; error: string } {
  const type = (contentType ?? "").split(";")[0]!.trim().toLowerCase();
  if (type === "application/x-www-form-urlencoded") {
    return { ok: true, fields: Object.fromEntries(new URLSearchParams(raw)) };
  }
  if (type === "application/json" || type === "" || type === "text/plain") {
    try {
      const json: unknown = JSON.parse(raw);
      if (json && typeof json === "object" && !Array.isArray(json)) return { ok: true, fields: json as Fields };
    } catch {
      // fall through
    }
    return { ok: false, status: 400, error: "invalid_json" };
  }
  return { ok: false, status: 415, error: "unsupported_content_type" };
}
