// lib/dailyStatusRefresh.ts
//
// Two entry points, both scoped to "managed users" only — current members of
// ECICS - SG (BS) union ECICS - MY (BS) (deduplicated). Nothing outside that
// union (e.g. rpauser, njx) is ever reset, written, or otherwise touched by
// either function below.
//
//   - runDailyStatusRefresh() — the scheduled 00:00 SGT/MYT job (Vercel Cron,
//     pages/api/cron/holiday-in-office.ts) ONLY. Full sequence: reset managed
//     users -> apply public holiday -> apply active leave. This is the only
//     place that resets anyone, and it only resets the managed-user set, not
//     the whole user_metadata table.
//
//   - runHolidayStatusRefresh() — the daytime, manager-triggered refresh used
//     by the Public Holidays dashboard page's "Run update now" button
//     (pages/api/dashboard/holidays/run.ts) and, per-country, automatically
//     after every add/edit/delete on that page (pages/api/dashboard/holidays.ts,
//     via refreshCountryStatus below). Deliberately does NOT reset anyone —
//     it recomputes each managed user's correct value directly (LOA > Public
//     Holiday > Normal) and writes it, so it's safe to run at any time of day
//     without clobbering unrelated state the way a blanket reset would.
//
// Both functions resolve LOA the same way: a fresh read of leave_periods for
// today's date, never inferred from the currently-stored in_office_reason.
// LOA always wins over Public Holiday, which always wins over Normal.
//
// Public holiday rules (both functions, identical): SG-only -> SG false/"SG
// Public Holiday", MY untouched/Normal. MY-only -> mirrored. Both SG and MY
// on holiday the same day -> BOTH sides true/"SG + MY Public Holiday" (not
// false — there's deliberately no exclusion when both countries are down at
// once). No holiday -> Normal.

import { supabaseAdmin } from "./supabaseAdmin";
import { assertUipathConfigured, findGroupIdByName, getResolvedGroupMembers } from "./uipath";
import { checkPublicHoliday, todayInSingaporeMalaysia } from "./publicHolidays";
import type { HolidayCountryCode } from "./categories";

// Real UiPath Identity group names (Admin > Identities > Groups).
const GROUP_NAME_BY_COUNTRY: Record<HolidayCountryCode, string> = {
  SG: "ECICS - SG (BS)",
  MY: "ECICS - MY (BS)",
};

const REASON = {
  NORMAL: "Normal",
  SG_HOLIDAY: "SG Public Holiday",
  MY_HOLIDAY: "MY Public Holiday",
  BOTH_HOLIDAY: "SG + MY Public Holiday",
  LOA: "LOA",
} as const;

type ResolvedMember = { identifier: string; email: string };

// --- Managed-user scope -----------------------------------------------

export type ManagedScope = {
  sgMembers: ResolvedMember[];
  myMembers: ResolvedMember[];
  allMembers: ResolvedMember[]; // deduplicated union, keyed by identifier
  sgCount: number;
  myCount: number;
  unionCount: number;
  duplicateCount: number; // sgCount + myCount - unionCount (members in both groups)
};

export async function getManagedUsers(): Promise<ManagedScope> {
  const [sgGroup, myGroup] = await Promise.all([
    findGroupIdByName(GROUP_NAME_BY_COUNTRY.SG),
    findGroupIdByName(GROUP_NAME_BY_COUNTRY.MY),
  ]);
  if (!sgGroup) throw new Error(`UiPath group "${GROUP_NAME_BY_COUNTRY.SG}" not found`);
  if (!myGroup) throw new Error(`UiPath group "${GROUP_NAME_BY_COUNTRY.MY}" not found`);

  const [sgMembers, myMembers] = await Promise.all([
    getResolvedGroupMembers(sgGroup.id),
    getResolvedGroupMembers(myGroup.id),
  ]);

  const byIdentifier = new Map<string, ResolvedMember>();
  for (const m of [...sgMembers, ...myMembers]) {
    if (!byIdentifier.has(m.identifier)) byIdentifier.set(m.identifier, m);
  }
  const allMembers = [...byIdentifier.values()];

  return {
    sgMembers,
    myMembers,
    allMembers,
    sgCount: sgMembers.length,
    myCount: myMembers.length,
    unionCount: allMembers.length,
    duplicateCount: sgMembers.length + myMembers.length - allMembers.length,
  };
}

// --- Shared write primitives --------------------------------------------

type GroupWriteResult = { updatedCount: number; newRowCount: number };

// Unconditionally writes in_office/in_office_reason for a given, already-
// resolved set of members — always overwrites (never "only if currently
// true"), since callers here always know the correct target value already;
// there's no stale-state case where "leave it alone" would be right.
async function writeGroupStatus(
  country: HolidayCountryCode,
  members: ResolvedMember[],
  inOffice: boolean,
  reason: string,
  now: string
): Promise<GroupWriteResult> {
  const identifiers = members.map((m) => m.identifier);
  if (identifiers.length === 0) return { updatedCount: 0, newRowCount: 0 };

  const { data: existingRows, error: selectError } = await supabaseAdmin()
    .from("user_metadata")
    .select("uipath_id")
    .in("uipath_id", identifiers);
  if (selectError) throw new Error(`${country} user_metadata lookup failed: ${selectError.message}`);

  const existingSet = new Set((existingRows || []).map((r: any) => r.uipath_id));
  const toUpdateIds = identifiers.filter((id) => existingSet.has(id));
  const toInsertMembers = members.filter((m) => !existingSet.has(m.identifier));

  const updatedBy = `cron:daily-status-refresh:${country}`;

  let updatedCount = 0;
  if (toUpdateIds.length > 0) {
    const { data, error } = await (supabaseAdmin().from("user_metadata") as any)
      .update({ in_office: inOffice, in_office_reason: reason, updated_at: now, updated_by: updatedBy })
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
      in_office: inOffice,
      in_office_reason: reason,
      updated_at: now,
      updated_by: updatedBy,
    }));
    const { data, error } = await supabaseAdmin().from("user_metadata").insert(newRows as any).select("uipath_id");
    if (error) throw new Error(`${country} insert failed: ${error.message}`);
    newRowCount = (data || []).length;
  }

  return { updatedCount, newRowCount };
}

export type LoaResult = { activeCount: number; updatedCount: number; newRowCount: number };

// Active leave for a specific, known set of identifiers — always a fresh
// leave_periods query for today's date, never inferred from
// in_office_reason. Shared by both entry points below, and by
// refreshCountryStatus, so "what counts as active LOA" can't drift between
// them.
async function applyActiveLeaveForIdentifiers(identifiers: string[], dateStr: string, now: string): Promise<LoaResult> {
  if (identifiers.length === 0) return { activeCount: 0, updatedCount: 0, newRowCount: 0 };

  const { data: activeLeave, error } = await supabaseAdmin()
    .from("leave_periods")
    .select("uipath_id, email")
    .in("uipath_id", identifiers)
    .lte("start_date", dateStr)
    .gte("end_date", dateStr);
  if (error) throw new Error(`leave_periods lookup failed: ${error.message}`);

  const rows = (activeLeave || []) as { uipath_id: string; email: string | null }[];
  const byUipathId = new Map(rows.map((r) => [r.uipath_id, r]));
  const activeIds = [...byUipathId.keys()];
  if (activeIds.length === 0) return { activeCount: 0, updatedCount: 0, newRowCount: 0 };

  const { data: existingRows, error: selectError } = await supabaseAdmin()
    .from("user_metadata")
    .select("uipath_id")
    .in("uipath_id", activeIds);
  if (selectError) throw new Error(`LOA user_metadata lookup failed: ${selectError.message}`);

  const existingSet = new Set((existingRows || []).map((r: any) => r.uipath_id));
  const toUpdateIds = activeIds.filter((id) => existingSet.has(id));
  const toInsertIds = activeIds.filter((id) => !existingSet.has(id));

  const updatedBy = "cron:daily-status-refresh:LOA";

  let updatedCount = 0;
  if (toUpdateIds.length > 0) {
    const { data, error: updateError } = await (supabaseAdmin().from("user_metadata") as any)
      .update({ in_office: false, in_office_reason: REASON.LOA, updated_at: now, updated_by: updatedBy })
      .in("uipath_id", toUpdateIds)
      .select("uipath_id");
    if (updateError) throw new Error(`LOA update failed: ${updateError.message}`);
    updatedCount = (data || []).length;
  }

  let newRowCount = 0;
  if (toInsertIds.length > 0) {
    const newRows = toInsertIds.map((id) => ({
      uipath_id: id,
      email: byUipathId.get(id)?.email || null,
      in_office: false,
      in_office_reason: REASON.LOA,
      updated_at: now,
      updated_by: updatedBy,
    }));
    const { data, error: insertError } = await supabaseAdmin().from("user_metadata").insert(newRows as any).select("uipath_id");
    if (insertError) throw new Error(`LOA insert failed: ${insertError.message}`);
    newRowCount = (data || []).length;
  }

  return { activeCount: activeIds.length, updatedCount, newRowCount };
}

// --- runDailyStatusRefresh() — scheduled cron only ----------------------

export type CountryResult = {
  isHoliday: boolean;
  holidayName?: string;
  groupName: string;
  groupMemberCount: number;
  updatedCount: number;
  newRowCount: number;
};

export type DailyStatusRefreshResult = {
  date: string;
  managedScope: { sgCount: number; myCount: number; unionCount: number; duplicateCount: number };
  resetCount: number;
  sg: CountryResult;
  my: CountryResult;
  loa: LoaResult;
};

function toCountryResult(
  groupName: string,
  groupMemberCount: number,
  isHoliday: boolean,
  holidayName: string | undefined,
  write: GroupWriteResult
): CountryResult {
  return { isHoliday, holidayName, groupName, groupMemberCount, ...write };
}

// Step 1 — reset ONLY the managed-user set (SG group ∪ MY group) to
// in_office=true/Normal. Never a blanket table-wide update — identifiers
// outside this set (rpauser, njx, ...) are never touched. Only updates rows
// that already exist; a managed user with no row yet still has nothing to
// reset (steps 2/3 insert a row only if they need to record a non-default
// value for them).
async function resetManagedUsers(identifiers: string[], now: string): Promise<number> {
  if (identifiers.length === 0) return 0;
  const { data, error } = await (supabaseAdmin().from("user_metadata") as any)
    .update({ in_office: true, in_office_reason: REASON.NORMAL, updated_at: now, updated_by: "cron:daily-status-refresh" })
    .in("uipath_id", identifiers)
    .select("uipath_id");
  if (error) throw new Error(`daily status reset failed: ${error.message}`);
  return (data || []).length;
}

export async function runDailyStatusRefresh(dateStr: string = todayInSingaporeMalaysia()): Promise<DailyStatusRefreshResult> {
  assertUipathConfigured();
  const now = new Date().toISOString();

  const managed = await getManagedUsers();
  const managedIds = managed.allMembers.map((m) => m.identifier);

  const resetCount = await resetManagedUsers(managedIds, now);

  const [sgCheck, myCheck] = await Promise.all([
    checkPublicHoliday("SG", dateStr),
    checkPublicHoliday("MY", dateStr),
  ]);

  const sgGroupName = GROUP_NAME_BY_COUNTRY.SG;
  const myGroupName = GROUP_NAME_BY_COUNTRY.MY;

  let sg: CountryResult;
  let my: CountryResult;

  if (sgCheck.isHoliday && myCheck.isHoliday) {
    const [sgWrite, myWrite] = await Promise.all([
      writeGroupStatus("SG", managed.sgMembers, true, REASON.BOTH_HOLIDAY, now),
      writeGroupStatus("MY", managed.myMembers, true, REASON.BOTH_HOLIDAY, now),
    ]);
    sg = toCountryResult(sgGroupName, managed.sgCount, true, sgCheck.name, sgWrite);
    my = toCountryResult(myGroupName, managed.myCount, true, myCheck.name, myWrite);
  } else if (sgCheck.isHoliday) {
    const sgWrite = await writeGroupStatus("SG", managed.sgMembers, false, REASON.SG_HOLIDAY, now);
    sg = toCountryResult(sgGroupName, managed.sgCount, true, sgCheck.name, sgWrite);
    my = toCountryResult(myGroupName, managed.myCount, false, undefined, { updatedCount: 0, newRowCount: 0 });
  } else if (myCheck.isHoliday) {
    const myWrite = await writeGroupStatus("MY", managed.myMembers, false, REASON.MY_HOLIDAY, now);
    my = toCountryResult(myGroupName, managed.myCount, true, myCheck.name, myWrite);
    sg = toCountryResult(sgGroupName, managed.sgCount, false, undefined, { updatedCount: 0, newRowCount: 0 });
  } else {
    sg = toCountryResult(sgGroupName, managed.sgCount, false, undefined, { updatedCount: 0, newRowCount: 0 });
    my = toCountryResult(myGroupName, managed.myCount, false, undefined, { updatedCount: 0, newRowCount: 0 });
  }

  const loa = await applyActiveLeaveForIdentifiers(managedIds, dateStr, now);

  return {
    date: dateStr,
    managedScope: {
      sgCount: managed.sgCount,
      myCount: managed.myCount,
      unionCount: managed.unionCount,
      duplicateCount: managed.duplicateCount,
    },
    resetCount,
    sg,
    my,
    loa,
  };
}

// --- refreshCountryStatus() / runHolidayStatusRefresh() — on-demand ----

export type CountryRefreshResult = {
  date: string;
  country: HolidayCountryCode;
  isHoliday: boolean;
  holidayName?: string;
  groupName: string;
  groupMemberCount: number;
  updatedCount: number;
  newRowCount: number;
  loa: LoaResult;
};

// Narrow recompute for one country only — no reset, no effect on the other
// country. Still checks BOTH countries' public-holiday status (needed to
// correctly produce "SG + MY Public Holiday" when both are a holiday on the
// same date), but only ever writes to the requested country's group, then
// applies LOA scoped to that same group. This is the building block for
// both the automatic per-country refresh after a holiday add/edit/delete
// (pages/api/dashboard/holidays.ts) and runHolidayStatusRefresh() below.
export async function refreshCountryStatus(
  country: HolidayCountryCode,
  dateStr: string = todayInSingaporeMalaysia()
): Promise<CountryRefreshResult> {
  assertUipathConfigured();
  const now = new Date().toISOString();

  const [sgCheck, myCheck] = await Promise.all([
    checkPublicHoliday("SG", dateStr),
    checkPublicHoliday("MY", dateStr),
  ]);
  const thisCheck = country === "SG" ? sgCheck : myCheck;
  const otherCheck = country === "SG" ? myCheck : sgCheck;

  let inOffice: boolean;
  let reason: string;
  if (thisCheck.isHoliday && otherCheck.isHoliday) {
    inOffice = true;
    reason = REASON.BOTH_HOLIDAY;
  } else if (thisCheck.isHoliday) {
    inOffice = false;
    reason = country === "SG" ? REASON.SG_HOLIDAY : REASON.MY_HOLIDAY;
  } else {
    inOffice = true;
    reason = REASON.NORMAL;
  }

  const groupName = GROUP_NAME_BY_COUNTRY[country];
  const group = await findGroupIdByName(groupName);
  if (!group) throw new Error(`UiPath group "${groupName}" not found`);
  const members = await getResolvedGroupMembers(group.id);
  const identifiers = members.map((m) => m.identifier);

  // LOA is checked/applied last so it always overrides the PH result above —
  // matches the approved priority LOA > Public Holiday > Normal.
  const write = await writeGroupStatus(country, members, inOffice, reason, now);
  const loa = await applyActiveLeaveForIdentifiers(identifiers, dateStr, now);

  return {
    date: dateStr,
    country,
    isHoliday: thisCheck.isHoliday,
    holidayName: thisCheck.name,
    groupName,
    groupMemberCount: identifiers.length,
    ...write,
    loa,
  };
}

export type HolidayStatusRefreshResult = {
  date: string;
  sg: CountryRefreshResult;
  my: CountryRefreshResult;
};

// The daytime, manager-triggered refresh (pages/api/dashboard/holidays/run.ts's
// "Run update now" button). No blanket reset — just refreshCountryStatus for
// both countries, each independently deciding LOA > PH > Normal per user.
// Safe to call at any time without disturbing anything runDailyStatusRefresh
// hasn't already set correctly.
export async function runHolidayStatusRefresh(dateStr: string = todayInSingaporeMalaysia()): Promise<HolidayStatusRefreshResult> {
  const [sg, my] = await Promise.all([refreshCountryStatus("SG", dateStr), refreshCountryStatus("MY", dateStr)]);
  return { date: dateStr, sg, my };
}

// --- runLeaveStatusRefresh() — LOA Management Portal only ---------------
//
// Deliberately narrower than everything above: touches ONLY people who have
// at least one leave_periods row (currently active or not) — never anyone
// else, and never recomputes a whole SG/MY group's Public Holiday status as
// a side effect the way refreshCountryStatus does. This is what the Leave
// Management page's "Run update now" button calls, and what
// pages/api/dashboard/leave.ts calls automatically after every add/edit/
// cancel, so a leave change takes effect immediately without touching
// anyone unrelated to leave at all.
//
// Still respects the managed-users-only rule (someone outside SG/MY groups
// gets a leave record saved but no live in_office write — see `managed` on
// each result) and the same LOA > Public Holiday > Normal priority as every
// other refresh path — a person here without active LOA today is set to
// whatever their correct Public Holiday/Normal value is, not left stale.

// If hasActiveLoa, LOA wins outright. Otherwise, Public Holiday applies only
// to whichever side(s) this specific person belongs to — mirrors
// refreshCountryStatus's 3-way branch, evaluated per-user instead of per-group.
function computeLoaAwareStatus(
  inSG: boolean,
  inMY: boolean,
  hasActiveLoa: boolean,
  sgHoliday: boolean,
  myHoliday: boolean
): { inOffice: boolean; reason: string } {
  if (hasActiveLoa) return { inOffice: false, reason: REASON.LOA };
  if (sgHoliday && myHoliday) return { inOffice: true, reason: REASON.BOTH_HOLIDAY };
  if (sgHoliday && inSG) return { inOffice: false, reason: REASON.SG_HOLIDAY };
  if (myHoliday && inMY) return { inOffice: false, reason: REASON.MY_HOLIDAY };
  return { inOffice: true, reason: REASON.NORMAL };
}

async function activeLoaSet(uipathIds: string[], dateStr: string): Promise<Set<string>> {
  if (uipathIds.length === 0) return new Set();
  const { data, error } = await supabaseAdmin()
    .from("leave_periods")
    .select("uipath_id")
    .in("uipath_id", uipathIds)
    .lte("start_date", dateStr)
    .gte("end_date", dateStr);
  if (error) throw new Error(`leave_periods lookup failed: ${error.message}`);
  return new Set((data || []).map((r: any) => r.uipath_id));
}

// Writes one row only — no group-wide effect. Upserts (insert if this
// uipath_id has never had a user_metadata row before).
async function writeSingleUserStatus(
  uipathId: string,
  email: string | undefined,
  inOffice: boolean,
  reason: string,
  now: string
): Promise<void> {
  const updatedBy = "cron:daily-status-refresh:LOA";
  const { data: existing, error: selectError } = await supabaseAdmin()
    .from("user_metadata")
    .select("uipath_id")
    .eq("uipath_id", uipathId)
    .maybeSingle();
  if (selectError) throw new Error(`user_metadata lookup failed for ${uipathId}: ${selectError.message}`);

  if (existing) {
    const { error } = await (supabaseAdmin().from("user_metadata") as any)
      .update({ in_office: inOffice, in_office_reason: reason, updated_at: now, updated_by: updatedBy })
      .eq("uipath_id", uipathId);
    if (error) throw new Error(`user_metadata update failed for ${uipathId}: ${error.message}`);
  } else {
    const { error } = await supabaseAdmin()
      .from("user_metadata")
      .insert({ uipath_id: uipathId, email: email || null, in_office: inOffice, in_office_reason: reason, updated_at: now, updated_by: updatedBy } as any);
    if (error) throw new Error(`user_metadata insert failed for ${uipathId}: ${error.message}`);
  }
}

export type UserLoaRefreshResult = {
  uipathId: string;
  email?: string;
  managed: boolean; // false = not a current SG/MY member; no write happened
  hasActiveLoa: boolean;
  inOffice?: boolean;
  reason?: string;
};

export type LeaveStatusRefreshResult = {
  date: string;
  affectedCount: number; // distinct people processed (anyone with a leave_periods row, plus extraUipathIds)
  managedCount: number; // of those, current SG/MY group members (only these get written)
  activeCount: number; // currently within an active leave period today
  results: UserLoaRefreshResult[];
};

// extraUipathIds lets a caller force one specific person into this run even
// if they currently have zero leave_periods rows — needed for cancel/delete,
// where the row that would otherwise identify them as "leave-relevant" was
// just removed, but they still need to be recomputed off of LOA back to
// their correct Public Holiday/Normal value.
export async function runLeaveStatusRefresh(
  dateStr: string = todayInSingaporeMalaysia(),
  extraUipathIds: string[] = []
): Promise<LeaveStatusRefreshResult> {
  assertUipathConfigured();
  const now = new Date().toISOString();

  const [{ data: leaveRows, error: leaveError }, managed, sgCheck, myCheck] = await Promise.all([
    supabaseAdmin().from("leave_periods").select("uipath_id"),
    getManagedUsers(),
    checkPublicHoliday("SG", dateStr),
    checkPublicHoliday("MY", dateStr),
  ]);
  if (leaveError) throw new Error(`leave_periods lookup failed: ${leaveError.message}`);

  const uipathIds = [...new Set([...(leaveRows || []).map((r: any) => r.uipath_id), ...extraUipathIds])];
  const activeIds = await activeLoaSet(uipathIds, dateStr);
  const memberByIdentifier = new Map(managed.allMembers.map((m) => [m.identifier, m]));

  const results: UserLoaRefreshResult[] = [];
  for (const uipathId of uipathIds) {
    const member = memberByIdentifier.get(uipathId);
    const inSG = managed.sgMembers.some((m) => m.identifier === uipathId);
    const inMY = managed.myMembers.some((m) => m.identifier === uipathId);
    const hasActiveLoa = activeIds.has(uipathId);

    if (!inSG && !inMY) {
      results.push({ uipathId, email: member?.email, managed: false, hasActiveLoa });
      continue;
    }

    const { inOffice, reason } = computeLoaAwareStatus(inSG, inMY, hasActiveLoa, sgCheck.isHoliday, myCheck.isHoliday);
    await writeSingleUserStatus(uipathId, member?.email, inOffice, reason, now);
    results.push({ uipathId, email: member?.email, managed: true, hasActiveLoa, inOffice, reason });
  }

  return {
    date: dateStr,
    affectedCount: uipathIds.length,
    managedCount: results.filter((r) => r.managed).length,
    activeCount: results.filter((r) => r.hasActiveLoa).length,
    results,
  };
}

// --- refreshUserStatus() — single person, no one else touched ----------
//
// The strictly person-scoped counterpart to runLeaveStatusRefresh() above.
// Where that one processes every uipath_id with a leave_periods row (a
// deliberate batch "catch everyone up" for the manual button),
// refreshUserStatus touches exactly the one uipathId passed in and nothing
// else — this is what pages/api/dashboard/leave.ts's add/edit/cancel calls,
// per the explicit requirement that a single leave change must not
// recompute any other person's status, managed or not.
//
// Logic: if this person has another active leave_periods row covering today
// (checked fresh — never inferred from the current in_office_reason), LOA
// wins (false/LOA). Otherwise, apply today's Public Holiday result for
// whichever SG/MY side they belong to, or true/Normal if neither applies.
export async function refreshUserStatus(
  uipathId: string,
  dateStr: string = todayInSingaporeMalaysia()
): Promise<UserLoaRefreshResult> {
  assertUipathConfigured();

  const managed = await getManagedUsers();
  const inSG = managed.sgMembers.some((m) => m.identifier === uipathId);
  const inMY = managed.myMembers.some((m) => m.identifier === uipathId);
  if (!inSG && !inMY) return { uipathId, managed: false, hasActiveLoa: false };

  const member = managed.allMembers.find((m) => m.identifier === uipathId);
  const now = new Date().toISOString();

  const [activeIds, sgCheck, myCheck] = await Promise.all([
    activeLoaSet([uipathId], dateStr),
    checkPublicHoliday("SG", dateStr),
    checkPublicHoliday("MY", dateStr),
  ]);
  const hasActiveLoa = activeIds.has(uipathId);

  const { inOffice, reason } = computeLoaAwareStatus(inSG, inMY, hasActiveLoa, sgCheck.isHoliday, myCheck.isHoliday);
  await writeSingleUserStatus(uipathId, member?.email, inOffice, reason, now);

  return { uipathId, email: member?.email, managed: true, hasActiveLoa, inOffice, reason };
}
