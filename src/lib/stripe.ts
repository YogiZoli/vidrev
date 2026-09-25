import { normalizeEmail, isValidEmail } from "./email";
import { readTid } from "./inbound";
import { normalizeCurrency } from "./money";

// Stripe revenue ingestion (DECISIONS section 15). Pure helpers: key checks
// and the mapping from a Stripe charge to the purchase we record. The API
// client is src/server/stripe/api.ts and the sync is src/worker/stripe.ts.

// Pinned so a change of Stripe's default version never changes our numbers.
export const STRIPE_API_VERSION = "2024-06-20";

// Why a pasted key is refused, or null when it is a live restricted key (P8-01).
export function keyProblem(raw: string): string | null {
  const key = raw.trim();
  if (key === "") return "Paste your restricted key.";
  if (/^sk_(live|test)_/.test(key)) {
    return "That is a full secret key. Create a restricted key with read access only, and paste that one instead.";
  }
  if (/^rk_test_/.test(key)) return "That is a test-mode key. Only live keys are used, because only real revenue is counted.";
  if (!/^rk_live_[A-Za-z0-9]{16,}$/.test(key)) return "That does not look like a Stripe restricted key. It starts with rk_live_.";
  return null;
}

export function keyLast4(key: string): string {
  return key.trim().slice(-4);
}

interface StripeMetadata {
  [key: string]: string | undefined;
}

export interface StripeCustomer {
  id: string;
  email?: string | null;
  name?: string | null;
  metadata?: StripeMetadata | null;
}

export interface StripeInvoice {
  id: string;
  subscription?: string | { id?: string } | null;
  // Newer API versions moved the subscription here.
  parent?: { subscription_details?: { subscription?: string | { id?: string } | null } | null } | null;
}

export interface StripeCharge {
  id: string;
  amount: number;
  amount_captured?: number;
  amount_refunded?: number;
  currency: string;
  created: number;
  paid?: boolean;
  status?: string;
  livemode?: boolean;
  customer?: string | StripeCustomer | null;
  invoice?: string | StripeInvoice | null;
  billing_details?: { email?: string | null; name?: string | null } | null;
  receipt_email?: string | null;
  metadata?: StripeMetadata | null;
}

export interface MappedCharge {
  externalId: string;
  email: string | null;
  name: string | null;
  tid: string | null;
  customerId: string | null;
  amountCents: number;
  currency: string;
  refundedCents: number;
  subscriptionId: string | null;
  occurredAt: Date;
}

function idOf(value: string | { id?: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : (value.id ?? null);
}

function emailOf(value: string | null | undefined): string | null {
  const email = value?.trim();
  return email && isValidEmail(email) ? normalizeEmail(email) : null;
}

// A charge that counts as a payment (P8-03): paid and succeeded, with money
// actually captured. Returns null for anything else.
export function mapCharge(charge: StripeCharge): MappedCharge | null {
  if (!charge.id || charge.livemode === false) return null;
  if (charge.paid === false || (charge.status !== undefined && charge.status !== "succeeded")) return null;
  const currency = normalizeCurrency(charge.currency);
  const amountCents = charge.amount_captured ?? charge.amount;
  if (!currency || !Number.isSafeInteger(amountCents) || amountCents <= 0) return null;

  const customer = typeof charge.customer === "object" && charge.customer ? charge.customer : null;
  const invoice = typeof charge.invoice === "object" && charge.invoice ? charge.invoice : null;
  const email = emailOf(customer?.email) ?? emailOf(charge.billing_details?.email) ?? emailOf(charge.receipt_email);
  const tid = readTid({ tid: charge.metadata?.c2c_tid ?? charge.metadata?.tid ?? customer?.metadata?.c2c_tid ?? customer?.metadata?.tid });
  const refunded = Math.max(0, Math.min(charge.amount_refunded ?? 0, amountCents));
  return {
    externalId: charge.id,
    email,
    name: (customer?.name ?? charge.billing_details?.name ?? null)?.slice(0, 200) ?? null,
    tid,
    customerId: idOf(charge.customer),
    amountCents,
    currency,
    refundedCents: refunded,
    subscriptionId: idOf(invoice?.subscription) ?? idOf(invoice?.parent?.subscription_details?.subscription),
    occurredAt: new Date(charge.created * 1000),
  };
}
