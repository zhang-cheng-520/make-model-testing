// pages/api/dashboard/leave.ts
//
// CRUD over the leave_periods table (scripts/migrate-leave-and-status-tables.mjs)
// for the LOA Management Portal. Protected by middleware.ts (all
// /api/dashboard/* routes require a valid dashboard session), same as
// metadata.ts and holidays.ts.
//
// Deliberately separate from pages/api/dashboard/metadata.ts's manual
// same-day in_office/in_office_reason update — this route only records
// planned leave; it never writes to user_metadata directly. Effective
// in_office/in_office_reason for an active leave period is only ever
// applied by the daily status refresh (lib/dailyStatusRefresh.ts), which
// queries this table fresh each run.
//
// Contract:
//   GET    /api/dashboard/leave[?uipathId=...]
//     -> 200 { leave: [{ id, uipathId, email, leaveType, startDate, endDate, note, createdAt, updatedAt, updatedBy }] }
//   POST   /api/dashboard/leave        body: { uipathId, email?, leaveType, startDate, endDate, note? }
//     -> 200 { leave, refresh: UserLoaRefreshResult, refreshError?: string }
//   PATCH  /api/dashboard/leave        body: { id, leaveType?, startDate?, endDate?, note? }
//     -> 200 { leave, refresh, refreshError? }
//   DELETE /api/dashboard/leave?id=...
//     -> 200 { success: true, refresh, refreshError? }
//
// uipathId/email are not editable via PATCH — if the wrong person was
// selected, cancel (DELETE) and create a new record instead, same
// id-is-stable-but-scoped-fields-only-editable shape as public_holidays'
// country_code/date (those ARE editable there; here uipathId simply isn't,
// since a leave record's identity is "this person's leave", not just a row).
//
// No seed-lock / checkEditable concept — nothing here is seeded, every
// record a user creates can be freely edited or cancelled.
//
// Every write here (add/edit/cancel) immediately calls
// lib/dailyStatusRefresh.ts's refreshUserStatus(uipathId) — strictly
// person-scoped: it recomputes and writes ONLY this one uipath_id's row,
// nothing else, not even other people who happen to have their own leave
// records. (This is deliberately NOT runLeaveStatusRefresh(), which batches
// over every uipath_id with a leave_periods row — that one is reserved for
// the Leave Management page's own "Run update now" button, a distinct
// manual catch-up action; a single add/edit/cancel must not incidentally
// recompute an unrelated person's status just because they also happen to
// have a leave record.) refreshUserStatus itself decides: if another active
// leave still covers today for this person, LOA wins (false/LOA); otherwise
// today's Public Holiday result for their side applies, or true/Normal if
// none does — so cancelling the leave that was keeping someone on LOA
// correctly reverts them, without touching anyone else.

import type { NextApiRequest, NextApiResponse } from "next";
import { supabaseAdmin } from "../../../lib/supabaseAdmin";
import { isValidLeaveType } from "../../../lib/leaveTypes";
import { refreshUserStatus, type UserLoaRefreshResult } from "../../../lib/dailyStatusRefresh";

const EDITOR_NAME = process.env.DASHBOARD_LOGIN_EMAIL || "dashboard";

// Best-effort — a refresh failure never rolls back the already-committed
// leave_periods write (see file header).
async function tryRefreshUser(uipathId: string): Promise<{ result?: UserLoaRefreshResult; error?: string }> {
  try {
    return { result: await refreshUserStatus(uipathId) };
  } catch (err: any) {
    console.error(`dashboard/leave: refreshUserStatus(${uipathId}) failed:`, err?.message || err);
    return { error: String(err?.message || err) };
  }
}

function isValidDate(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
}

function toApiRow(row: any) {
  return {
    id: row.id,
    uipathId: row.uipath_id,
    email: row.email,
    leaveType: row.leave_type,
    startDate: row.start_date,
    endDate: row.end_date,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") return handleGet(req, res);
  if (req.method === "POST") return handlePost(req, res);
  if (req.method === "PATCH") return handlePatch(req, res);
  if (req.method === "DELETE") return handleDelete(req, res);
  return res.status(405).json({ error: "Use GET, POST, PATCH or DELETE" });
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const { uipathId } = req.query;
  try {
    let query = supabaseAdmin()
      .from("leave_periods")
      .select("id, uipath_id, email, leave_type, start_date, end_date, note, created_at, updated_at, updated_by")
      .order("start_date", { ascending: true });

    if (typeof uipathId === "string" && uipathId) {
      query = query.eq("uipath_id", uipathId);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return res.status(200).json({ leave: (data || []).map(toApiRow) });
  } catch (err: any) {
    console.error("dashboard/leave GET error:", err?.message || err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const { uipathId, email, leaveType, startDate, endDate, note } = (req.body || {}) as {
    uipathId?: string;
    email?: string;
    leaveType?: string;
    startDate?: string;
    endDate?: string;
    note?: string;
  };

  if (!uipathId || !uipathId.trim()) return res.status(400).json({ error: "uipathId is required" });
  if (!isValidLeaveType(leaveType || "")) return res.status(400).json({ error: `leaveType must be one of the fixed options` });
  if (!isValidDate(startDate)) return res.status(400).json({ error: "startDate must be YYYY-MM-DD" });
  if (!isValidDate(endDate)) return res.status(400).json({ error: "endDate must be YYYY-MM-DD" });
  if (endDate < startDate) return res.status(400).json({ error: "endDate must be on or after startDate" });

  try {
    const { data, error } = await supabaseAdmin()
      .from("leave_periods")
      .insert({
        uipath_id: uipathId.trim(),
        email: email || null,
        leave_type: leaveType,
        start_date: startDate,
        end_date: endDate,
        note: note?.trim() || null,
        updated_at: new Date().toISOString(),
        updated_by: EDITOR_NAME,
      } as any)
      .select("id, uipath_id, email, leave_type, start_date, end_date, note, created_at, updated_at, updated_by")
      .single();
    if (error) throw new Error(error.message);

    const { result: refresh, error: refreshError } = await tryRefreshUser((data as any).uipath_id);
    return res.status(200).json({ leave: toApiRow(data), refresh, ...(refreshError ? { refreshError } : {}) });
  } catch (err: any) {
    console.error("dashboard/leave POST error:", err?.message || err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
}

async function handlePatch(req: NextApiRequest, res: NextApiResponse) {
  const { id, leaveType, startDate, endDate, note } = (req.body || {}) as {
    id?: string;
    leaveType?: string;
    startDate?: string;
    endDate?: string;
    note?: string;
  };

  if (!id) return res.status(400).json({ error: "id is required" });
  if (leaveType !== undefined && !isValidLeaveType(leaveType)) {
    return res.status(400).json({ error: `leaveType must be one of the fixed options` });
  }
  if (startDate !== undefined && !isValidDate(startDate)) return res.status(400).json({ error: "startDate must be YYYY-MM-DD" });
  if (endDate !== undefined && !isValidDate(endDate)) return res.status(400).json({ error: "endDate must be YYYY-MM-DD" });

  const patch: Record<string, any> = { updated_at: new Date().toISOString(), updated_by: EDITOR_NAME };
  if (leaveType !== undefined) patch.leave_type = leaveType;
  if (startDate !== undefined) patch.start_date = startDate;
  if (endDate !== undefined) patch.end_date = endDate;
  if (note !== undefined) patch.note = note.trim() || null;

  try {
    const { data, error } = await (supabaseAdmin().from("leave_periods") as any)
      .update(patch)
      .eq("id", id)
      .select("id, uipath_id, email, leave_type, start_date, end_date, note, created_at, updated_at, updated_by")
      .single();
    if (error) {
      if (error.code === "23514") {
        return res.status(400).json({ error: "endDate must be on or after startDate" });
      }
      throw new Error(error.message);
    }
    if (!data) return res.status(404).json({ error: "Leave record not found" });

    const { result: refresh, error: refreshError } = await tryRefreshUser((data as any).uipath_id);
    return res.status(200).json({ leave: toApiRow(data), refresh, ...(refreshError ? { refreshError } : {}) });
  } catch (err: any) {
    console.error("dashboard/leave PATCH error:", err?.message || err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
}

async function handleDelete(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;
  if (typeof id !== "string") return res.status(400).json({ error: "id is required" });

  try {
    const { data, error } = await supabaseAdmin()
      .from("leave_periods")
      .delete()
      .eq("id", id)
      .select("uipath_id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return res.status(404).json({ error: "Leave record not found" });

    const { result: refresh, error: refreshError } = await tryRefreshUser((data as any).uipath_id);
    return res.status(200).json({ success: true, refresh, ...(refreshError ? { refreshError } : {}) });
  } catch (err: any) {
    console.error("dashboard/leave DELETE error:", err?.message || err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
