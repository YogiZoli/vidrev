// Wording of the public audit pages (DECISIONS P9-01, P9-10).

export const FAILURE_TEXT: Record<string, string> = {
  not_found: "We could not find that channel. Check the @handle, or paste the channel URL that contains /@handle.",
  no_videos: "This channel has no public videos to audit yet.",
  busy: "Audits are at capacity for today: YouTube limits how many requests this tool may make each day. Please try again after midnight Pacific time.",
  not_configured: "Audit my channel is not available right now. Please try again later.",
  bad_input: "We could not read that channel. Paste your @handle or the channel URL.",
  error: "Something went wrong while reading the channel. Please try again in a few minutes.",
};

export function failureText(reason: string | null): string {
  return FAILURE_TEXT[reason ?? "error"] ?? FAILURE_TEXT.error!;
}

// The marketing consent is separate from the report and never pre-checked (D-08).
export const MARKETING_CONSENT_TEXT = "Also send me occasional tips on turning comments into subscribers and buyers. I can unsubscribe at any time.";

export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "your email";
  return `${local.slice(0, 1)}***@${domain}`;
}
