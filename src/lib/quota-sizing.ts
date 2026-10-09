// Sizing for the YouTube quota extension request (docs/compliance/QUOTA-EXTENSION.md),
// computed from the real quota ledger instead of estimates.

export interface LedgerRow {
  datePt: string;
  method: string;
  units: number;
  accountId?: string | null;
}

export interface QuotaSizing {
  days: number;
  totalUnits: number;
  averageDayUnits: number;
  peakDayUnits: number;
  // calls = ledger rows (one per charged call or page), so units / calls is the cost per call.
  byMethod: { method: string; units: number; calls: number; share: number }[];
  // Zero-unit sources that replace quota calls (RSS feed, WebSub push).
  free: { method: string; calls: number }[];
  // Units per account per day, over the days that account made calls.
  perAccount: { accounts: number; median: number; max: number } | null;
  activeChannels: number;
  unitsPerChannelPerDay: number | null;
  projection: { channels: number; unitsPerDay: number }[];
  suggestedRequest: number | null;
}

const PROJECTED_CHANNELS = [100, 1_000, 10_000];
const HEADROOM = 1.3;
const STEP = 10_000;

export function sizeQuota(rows: LedgerRow[], activeChannels: number): QuotaSizing {
  const perDay = new Map<string, number>();
  const perMethod = new Map<string, { units: number; calls: number }>();
  const free = new Map<string, number>();
  const accountDays = new Map<string, number>();
  for (const row of rows) {
    if (row.method.startsWith("free:")) {
      free.set(row.method, (free.get(row.method) ?? 0) + 1);
      continue;
    }
    perDay.set(row.datePt, (perDay.get(row.datePt) ?? 0) + row.units);
    const m = perMethod.get(row.method) ?? { units: 0, calls: 0 };
    perMethod.set(row.method, { units: m.units + row.units, calls: m.calls + 1 });
    if (row.accountId) {
      const key = `${row.accountId}|${row.datePt}`;
      accountDays.set(key, (accountDays.get(key) ?? 0) + row.units);
    }
  }
  const perAccountDay = new Map<string, number[]>();
  for (const [key, units] of accountDays) {
    const id = key.slice(0, key.indexOf("|"));
    perAccountDay.set(id, [...(perAccountDay.get(id) ?? []), units]);
  }
  const accountAverages = [...perAccountDay.values()].map((d) => d.reduce((a, b) => a + b, 0) / d.length).sort((a, b) => a - b);
  const days = perDay.size;
  const totalUnits = [...perDay.values()].reduce((a, b) => a + b, 0);
  const perChannel = days > 0 && activeChannels > 0 ? totalUnits / days / activeChannels : null;
  return {
    days,
    totalUnits,
    averageDayUnits: days > 0 ? Math.round(totalUnits / days) : 0,
    peakDayUnits: Math.max(0, ...perDay.values()),
    byMethod: [...perMethod.entries()]
      .map(([method, m]) => ({ method, units: m.units, calls: m.calls, share: totalUnits > 0 ? m.units / totalUnits : 0 }))
      .sort((a, b) => b.units - a.units),
    free: [...free.entries()].map(([method, calls]) => ({ method, calls })).sort((a, b) => b.calls - a.calls),
    perAccount:
      accountAverages.length === 0
        ? null
        : {
            accounts: accountAverages.length,
            median: Math.round(accountAverages[Math.floor((accountAverages.length - 1) / 2)]!),
            max: Math.round(accountAverages[accountAverages.length - 1]!),
          },
    activeChannels,
    unitsPerChannelPerDay: perChannel === null ? null : Math.round(perChannel),
    projection: perChannel === null ? [] : PROJECTED_CHANNELS.map((channels) => ({ channels, unitsPerDay: Math.round(perChannel * channels) })),
    suggestedRequest: perChannel === null ? null : Math.ceil((perChannel * 100 * HEADROOM) / STEP) * STEP,
  };
}
