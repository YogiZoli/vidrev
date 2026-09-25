import { z } from "zod";

// Emails are matched in normalized form everywhere (SPEC section 5).
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const emailSchema = z.email();

export function isValidEmail(email: string): boolean {
  return emailSchema.safeParse(normalizeEmail(email)).success;
}

// ADMIN_EMAILS is a comma separated list.
export function parseEmailList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map(normalizeEmail)
    .filter((email) => email.length > 0);
}
