// "See where I lose money on YouTube" (DECISIONS L-11, L-12): every money
// figure comes from the creator's own inputs times counts we measured. The
// per-1,000-views comparison is an example, labelled as such on the page.

export const EXAMPLE_VIEWS = 1000;
// Example: 10% of 1,000 viewers become leads with an email.
export const EXAMPLE_LEADS_PER_1000 = 100;
// Example AdSense revenue per 1,000 views at a high CPM.
export const EXAMPLE_ADSENSE_PER_1000 = 25;

export interface MoneyInput {
  // Unanswered buying signals counted in the audit.
  signals: number;
  // The creator's price, USD a month.
  price: number;
  // Of 100 interested people, how many buy (1 to 100).
  buyRate: number;
}

export function validMoneyInput(price: number, buyRate: number): boolean {
  return Number.isFinite(price) && price > 0 && Number.isFinite(buyRate) && buyRate > 0 && buyRate <= 100;
}

export function moneyLeft({ signals, price, buyRate }: MoneyInput) {
  const buyers = (signals * buyRate) / 100;
  return { buyers, monthly: buyers * price };
}

export function ownershipComparison(price: number, buyRate: number) {
  const buyers = (EXAMPLE_LEADS_PER_1000 * buyRate) / 100;
  const monthly = buyers * price;
  return { leads: EXAMPLE_LEADS_PER_1000, buyers, monthly, adsense: EXAMPLE_ADSENSE_PER_1000, multiple: monthly / EXAMPLE_ADSENSE_PER_1000 };
}

export function formatUsd(value: number): string {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

// The multiple keeps two decimals (owner: "38.80" is more convincing because it is exact).
export function formatMultiple(value: number): string {
  return value.toFixed(2);
}
