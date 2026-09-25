// Sizing for the YouTube quota extension request (docs/compliance/QUOTA-EXTENSION.md),
// computed from the real quota ledger instead of estimates.

export interface LedgerRow {
  datePt: string;
  method: string;
  units: number;
}

export interface QuotaSizing {
  days: number;
  totalUnits: number;
  averageDayUnits: number;
  peakDayUnits: number;
  byMethod: { method: string; units: number; share: number }[];
  activeChannels: number;
  unitsPerChannelPerDay: number | null;
  projection: { channels: number; unitsPerDay: number }[];
  suggestedRequest: number | null;
}

const PROJECTED_CHANNELS = [13, 50, 100, 250];
const HEADROOM = 1.3;
const STEP = 10_000;

export function sizeQuota(rows: LedgerRow[], activeChannels: number): QuotaSizing {
  const perDay = new Map<string, number>();
  const perMethod = new Map<string, number>();
  for (const row of rows) {
    perDay.set(row.datePt, (perDay.get(row.datePt) ?? 0) + row.units);
    perMethod.set(row.method, (perMethod.get(row.method) ?? 0) + row.units);
  }
  const days = perDay.size;
  const totalUnits = [...perDay.values()].reduce((a, b) => a + b, 0);
  const perChannel = days > 0 && activeChannels > 0 ? totalUnits / days / activeChannels : null;
  return {
    days,
    totalUnits,
    averageDayUnits: days > 0 ? Math.round(totalUnits / days) : 0,
    peakDayUnits: Math.max(0, ...perDay.values()),
    byMethod: [...perMethod.entries()]
      .map(([method, units]) => ({ method, units, share: totalUnits > 0 ? units / totalUnits : 0 }))
      .sort((a, b) => b.units - a.units),
    activeChannels,
    unitsPerChannelPerDay: perChannel === null ? null : Math.round(perChannel),
    projection: perChannel === null ? [] : PROJECTED_CHANNELS.map((channels) => ({ channels, unitsPerDay: Math.round(perChannel * channels) })),
    suggestedRequest: perChannel === null ? null : Math.ceil((perChannel * 100 * HEADROOM) / STEP) * STEP,
  };
}
