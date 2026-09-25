// Amounts are stored as integer minor units ("cents") with their currency
// (SPEC section 5). Never floats, never converted between currencies.

const ZERO_DECIMAL = new Set(["BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF"]);
const THREE_DECIMAL = new Set(["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"]);

export function minorUnitExponent(currency: string): number {
  const code = currency.toUpperCase();
  return ZERO_DECIMAL.has(code) ? 0 : THREE_DECIMAL.has(code) ? 3 : 2;
}

export function normalizeCurrency(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

// "97", "97.5", 97.5 and "97.50" are accepted; thousands separators and
// currency symbols are not (a comma is ambiguous between "1,234" and "12,50").
// Returns null when the value is not a plain non-negative decimal.
export function toMinorUnits(amount: unknown, currency: string): number | null {
  const text = typeof amount === "number" ? (Number.isFinite(amount) ? String(amount) : "") : typeof amount === "string" ? amount.trim() : "";
  const match = /^(\d{1,12})(?:\.(\d+))?$/.exec(text);
  if (!match) return null;
  const exponent = minorUnitExponent(currency);
  const fraction = match[2] ?? "";
  // More decimals than the currency has: only accept trailing zeros.
  if (fraction.length > exponent && /[1-9]/.test(fraction.slice(exponent))) return null;
  const minor = Number(match[1]) * 10 ** exponent + Number(fraction.slice(0, exponent).padEnd(exponent, "0") || "0");
  return Number.isSafeInteger(minor) ? minor : null;
}
