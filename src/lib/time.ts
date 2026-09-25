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
