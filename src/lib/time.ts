// The YouTube quota day resets at midnight Pacific time (D-31). Reply caps
// use the same calendar so "today" means the same thing everywhere.
const PACIFIC = "America/Los_Angeles";

const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: PACIFIC,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// "YYYY-MM-DD" of the Pacific-time day that contains `at`.
export function pacificDate(at: Date): string {
  return dayFormatter.format(at);
}

// "YYYY-MM" of the Pacific-time month that contains `at`.
export function pacificMonth(at: Date): string {
  return pacificDate(at).slice(0, 7);
}

// First instant of the next Pacific-time day (the YouTube quota reset).
// Steps forward and then narrows down, so DST changes need no special case.
export function nextPacificMidnight(now: Date): Date {
  const today = pacificDate(now);
  let low = now.getTime();
  let high = low + 60_000;
  while (pacificDate(new Date(high)) === today) high += 3_600_000;
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (pacificDate(new Date(mid)) === today) low = mid;
    else high = mid;
  }
  return new Date(high);
}

// Reports (Phase 7) count by calendar day in the account's time zone.
const zonedFormatters = new Map<string, Intl.DateTimeFormat>();

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone });
    return true;
  } catch {
    return false;
  }
}

// "YYYY-MM-DD" of the day in `timeZone` that contains `at`.
export function zonedDay(at: Date, timeZone: string): string {
  let formatter = zonedFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    zonedFormatters.set(timeZone, formatter);
  }
  return formatter.format(at);
}

// Calendar arithmetic on "YYYY-MM-DD" strings (no time zone involved).
export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}
