import { eq } from "drizzle-orm";
import { appSettings } from "@/db/schema";
import type { DbOrTx } from "./accounts";

// Global settings are data (DECISIONS Q-02). Seeds never overwrite an edited row.
export const SETTING_DEFAULTS = {
  // Share of the daily quota kept for replies, in percent (owner, 2026-09-25).
  reply_reserve_pct: 75,
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;

export async function seedSettings(db: DbOrTx): Promise<void> {
  await db
    .insert(appSettings)
    .values(Object.entries(SETTING_DEFAULTS).map(([key, value]) => ({ key, value })))
    .onConflictDoNothing({ target: appSettings.key });
}

export async function getNumberSetting(db: DbOrTx, key: SettingKey): Promise<number> {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, key));
  return typeof row?.value === "number" ? row.value : SETTING_DEFAULTS[key];
}
