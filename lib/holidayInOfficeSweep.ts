// lib/holidayInOfficeSweep.ts
//
// Core logic shared by pages/api/cron/holiday-in-office.ts (the daily Vercel
// Cron job) and pages/api/dashboard/holidays/run.ts (an on-demand trigger for
// testing, from the Public Holidays dashboard page). For Singapore and
// Malaysia independently: if the given date is a public holiday in that
// country, flips `in_office` to false for every member of that country's
// UiPath Identity group (GROUP_NAME_BY_COUNTRY below) — the same live-
// membership source of truth ca-assign-task.ts and the HR Dashboard already
// use, rather than a separate category tag.
//
// Deliberately one-directional: this never sets in_office back to true. A
// manager may have someone marked out of office for MC/leave/other reasons
// that don't end when the public holiday does — only a human (via the HR
// Dashboard) should ever flip a member back to in-office.
//
// A member with no user_metadata row yet is created with in_office=false (a
// missing row otherwise defaults to in-office — see ca-assign-task.ts — so
// leaving it absent would silently fail to take them out of the pool). A
// member who already has in_office=false (e.g. on MC) is left completely
// untouched, so their existing updated_at/updated_by trail isn't clobbered.

import { supabaseAdmin } from "./supabaseAdmin";
import { assertUipathConfigured, findGroupIdByName, getResolvedGroupMembers } from "./uipath";
import { checkPublicHoliday, todayInSingaporeMalaysia } from "./publicHolidays";
import type { HolidayCountryCode } from "./categories";

// Real UiPath Identity group names (Admin > Identities > Groups), resolved by
// name at request time same as ca-assign-task.ts's FALLBACK_GROUP_NAME.
const GROUP_NAME_BY_COUNTRY: Record<HolidayCountryCode, string> = {
  SG: "ECICS - SG (BS)",
  MY: "ECICS - MY (BS)",
};

export type CountryResult = {
  isHoliday: boolean;
  holidayName?: string;
  groupName?: string;
  groupMemberCount?: number;
  updatedCount: number;
  newRowCount: number;
};

export type SweepResult = { date: string; sg: CountryResult; my: CountryResult };

async function markCountryOutOfOffice(country: HolidayCountryCode, dateStr: string): Promise<CountryResult> {
  const { isHoliday, name } = await checkPublicHoliday(country, dateStr);
  if (!isHoliday) return { isHoliday: false, updatedCount: 0, newRowCount: 0 };

  const groupName = GROUP_NAME_BY_COUNTRY[country];
  const group = await findGroupIdByName(groupName);
  if (!group) throw new Error(`UiPath group "${groupName}" not found`);

  const members = await getResolvedGroupMembers(group.id);
  const identifiers = members.map((m) => m.identifier);
  if (identifiers.length === 0) {
    return { isHoliday: true, holidayName: name, groupName, groupMemberCount: 0, updatedCount: 0, newRowCount: 0 };
  }

  const now = new Date().toISOString();
  const updatedBy = `cron:public-holiday:${country}`;

  const { data: existingRows, error: selectError } = await supabaseAdmin()
    .from("user_metadata")
    .select("uipath_id, in_office")
    .in("uipath_id", identifiers);
  if (selectError) throw new Error(`${country} user_metadata lookup failed: ${selectError.message}`);

  const existingByUipathId = new Map((existingRows || []).map((r: any) => [r.uipath_id, r.in_office]));
  const toUpdateIds = identifiers.filter((id) => existingByUipathId.get(id) === true);
  const toInsertMembers = members.filter((m) => !existingByUipathId.has(m.identifier));

  let updatedCount = 0;
  if (toUpdateIds.length > 0) {
    const { data, error } = await (supabaseAdmin().from("user_metadata") as any)
      .update({ in_office: false, updated_at: now, updated_by: updatedBy })
      .in("uipath_id", toUpdateIds)
      .select("uipath_id");
    if (error) throw new Error(`${country} update failed: ${error.message}`);
    updatedCount = (data || []).length;
  }

  let newRowCount = 0;
  if (toInsertMembers.length > 0) {
    const newRows = toInsertMembers.map((m) => ({
      uipath_id: m.identifier,
      email: m.email || null,
      in_office: false,
      updated_at: now,
      updated_by: updatedBy,
    }));
    const { data, error } = await supabaseAdmin()
      .from("user_metadata")
      .insert(newRows as any)
      .select("uipath_id");
    if (error) throw new Error(`${country} insert failed: ${error.message}`);
    newRowCount = (data || []).length;
  }

  return {
    isHoliday: true,
    holidayName: name,
    groupName,
    groupMemberCount: identifiers.length,
    updatedCount,
    newRowCount,
  };
}

export async function runHolidayInOfficeSweep(dateStr: string = todayInSingaporeMalaysia()): Promise<SweepResult> {
  assertUipathConfigured();
  const [sg, my] = await Promise.all([
    markCountryOutOfOffice("SG", dateStr),
    markCountryOutOfOffice("MY", dateStr),
  ]);
  return { date: dateStr, sg, my };
}
