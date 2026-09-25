import { z } from "zod";
import { hmacSha256Hex, safeEqual } from "@/lib/crypto";

// GHL workflows send this body from a Custom Webhook action (see
// docs/GHL-PROVISIONING.md). Empty merge fields arrive as "", so they are
// treated as missing.
export const PROVISIONING_EVENTS = [
  "purchase",
  "subscription_created",
  "trial_started",
  "plan_changed",
  "subscription_cancelled",
  "payment_failed",
] as const;
export type ProvisioningEventName = (typeof PROVISIONING_EVENTS)[number];

const blankToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;
const optionalString = z.preprocess(blankToUndefined, z.string().trim().min(1).optional());
const optionalDate = z.preprocess(blankToUndefined, z.coerce.date().optional());

export const provisioningPayloadSchema = z.object({
  event: z.enum(PROVISIONING_EVENTS),
  // Unique id of this occurrence (order, transaction or invoice id). Together
  // with `event` it is the idempotency key (SPEC-REVIEW R-05).
  external_id: z.preprocess((v) => (typeof v === "number" ? String(v) : v), z.string().trim().min(1)),
  email: z.string().trim().pipe(z.email()),
  name: optionalString,
  plan_code: optionalString,
  // The subscription this event belongs to. A cancellation only suspends the
  // account when it matches the subscription that activated it.
  subscription_id: optionalString,
  occurred_at: optionalDate,
  trial_ends_at: optionalDate,
});

export type ProvisioningPayload = z.infer<typeof provisioningPayloadSchema>;

// Bearer secret, compared in constant time. GHL's Custom Webhook action can
// set headers but cannot sign bodies; if an X-Signature (hex HMAC-SHA256 of
// the raw body) is present anyway, it must be valid too (DECISIONS Q-04).
export function authorizeProvisioning(
  headers: { authorization: string | null; signature: string | null },
  rawBody: string,
  secret: string,
): boolean {
  const auth = headers.authorization ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
  if (!match || !safeEqual(match[1]!, secret)) return false;
  if (headers.signature) {
    const provided = headers.signature.replace(/^sha256=/i, "").trim().toLowerCase();
    if (!safeEqual(provided, hmacSha256Hex(rawBody, secret))) return false;
  }
  return true;
}
