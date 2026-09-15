// lib/publicHolidays.ts
// Server-side public-holiday lookup for the cron automation
// (pages/api/cron/holiday-in-office.ts). Reads from the public_holidays
// Supabase table (scripts/migrate-public-holidays-table.mjs) — the DB is the
// source of truth at runtime, not an external API or bundled package. Rows
// are populated/refreshed occasionally via scripts/seed-public-holidays.ts,
// or can be edited by hand directly in the table.

import { supabaseAdmin } from "./supabaseAdmin";
import type { HolidayCountryCode } from "./categories";

// Singapore and Malaysia are both UTC+8 year-round (no DST) — "today" for
// the holiday check is computed in this fixed offset regardless of where
// the cron function actually runs.
const SGT_OFFSET_MS = 8 * 60 * 60 * 1000;

export function todayInSingaporeMalaysia(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() + SGT_OFFSET_MS);
  return shifted.toISOString().slice(0, 10); // YYYY-MM-DD
}

export type HolidayCheckResult = { isHoliday: boolean; name?: string };

export async function checkPublicHoliday(
  countryCode: HolidayCountryCode,
  dateStr: string
): Promise<HolidayCheckResult> {
  const { data, error } = await supabaseAdmin()
    .from("public_holidays")
    .select("name")
    .eq("country_code", countryCode)
    .eq("holiday_date", dateStr)
    .maybeSingle();
  if (error) throw new Error(`public_holidays lookup failed (${countryCode} ${dateStr}): ${error.message}`);

  return data ? { isHoliday: true, name: (data as any).name } : { isHoliday: false };
}
