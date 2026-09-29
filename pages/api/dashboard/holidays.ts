// pages/api/dashboard/holidays.ts
//
// CRUD over the public_holidays table (scripts/migrate-public-holidays-table.mjs)
// — the same table pages/api/cron/holiday-in-office.ts reads at runtime.
// Protected by middleware.ts (all /api/dashboard/* routes require a valid
// dashboard session), same as metadata.ts.
//
// Contract:
//   GET    /api/dashboard/holidays[?year=2026]
//     -> 200 { holidays: [{ id, countryCode, date, name, lastUpdated, editorName }] }
//   POST   /api/dashboard/holidays        body: { countryCode, date, name }
//     -> 200 { holiday, refresh: HolidayStatusRefreshResult }
//   PATCH  /api/dashboard/holidays        body: { id, countryCode?, date?, name? }
//     -> 200 { holiday, refresh: HolidayStatusRefreshResult }
//   DELETE /api/dashboard/holidays?id=...
//     -> 200 { success: true, refresh: HolidayStatusRefreshResult }
//
// Every write here that could change today's status (add, edit, delete)
// immediately calls lib/dailyStatusRefresh.ts's runHolidayStatusRefresh() —
// ALWAYS both countries, never just the one that was directly edited. This
// is required, not just convenient: each country's correct value depends on
// BOTH countries' holiday status jointly (that's how "both-side PH" is
// detected), so e.g. adding an MY holiday on a day SG already has one can
// change SG's correct value too (false/"SG Public Holiday" -> true/"SG + MY
// Public Holiday") even though SG's own row wasn't touched. Refreshing only
// the edited row's country was a real bug — see git history. No blanket
// reset — same as runHolidayStatusRefresh() always. If the refresh step
// itself fails, the CRUD write still succeeds (it already committed) and the
// response carries refreshError instead, same pattern as
// ca-request-reassignment.ts not rolling back a successful write when a
// secondary step fails.
//
// editor_name is not client-supplied — v1 login is one shared account (no
// per-user identity, same limitation as user_metadata.updated_by, see
// docs/PRD-hr-dashboard.md §5.5), so every write is stamped with the shared
// DASHBOARD_LOGIN_EMAIL rather than a free-typed name.
//
// Rows still carrying editor_name = SEED_EDITOR_NAME are the original seeded
// baseline (scripts/seed-public-holidays.ts) and have never been touched by
// a dashboard user — PATCH/DELETE refuse to touch them, so the seed data
// can't be edited or deleted from here. Only rows a user has already added
// or edited (editor_name = EDITOR_NAME) can be further edited/deleted.

import type { NextApiRequest, NextApiResponse } from "next";
import { supabaseAdmin } from "../../../lib/supabaseAdmin";
import { SEED_EDITOR_NAME } from "../../../lib/publicHolidays";
import { runHolidayStatusRefresh, type HolidayStatusRefreshResult } from "../../../lib/dailyStatusRefresh";

const EDITOR_NAME = process.env.DASHBOARD_LOGIN_EMAIL || "dashboard";

const COUNTRY_CODES = ["SG", "MY"] as const;
type CountryCode = (typeof COUNTRY_CODES)[number];

// Best-effort — a refresh failure never rolls back the already-committed
// CRUD write (see file header). Returns either the result or an error string.
async function tryRefreshBoth(): Promise<{ result?: HolidayStatusRefreshResult; error?: string }> {
  try {
    return { result: await runHolidayStatusRefresh() };
  } catch (err: any) {
    console.error("dashboard/holidays: runHolidayStatusRefresh failed:", err?.message || err);
    return { error: String(err?.message || err) };
  }
}

function isCountryCode(v: unknown): v is CountryCode {
  return typeof v === "string" && (COUNTRY_CODES as readonly string[]).includes(v);
}

function isValidDate(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
}

function toApiRow(row: any) {
  return {
    id: row.id,
    countryCode: row.country_code,
    date: row.holiday_date,
    name: row.name,
    lastUpdated: row.last_updated,
    editorName: row.editor_name,
  };
}

// Returns an error to send back if the row can't be edited/deleted (seeded
// and never touched by a user, or not found), or null if it's editable.
async function checkEditable(id: string): Promise<{ status: number; error: string } | null> {
  const { data, error } = await supabaseAdmin()
    .from("public_holidays")
    .select("editor_name")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { status: 404, error: "Holiday not found" };
  if ((data as any).editor_name === SEED_EDITOR_NAME) {
    return { status: 403, error: "This is a seeded default holiday and can't be edited or deleted here" };
  }
  return null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") return handleGet(req, res);
  if (req.method === "POST") return handlePost(req, res);
  if (req.method === "PATCH") return handlePatch(req, res);
  if (req.method === "DELETE") return handleDelete(req, res);
  return res.status(405).json({ error: "Use GET, POST, PATCH or DELETE" });
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const { year } = req.query;
  try {
    let query = supabaseAdmin()
      .from("public_holidays")
      .select("id, country_code, holiday_date, name, last_updated, editor_name")
      .order("holiday_date", { ascending: true })
      .order("country_code", { ascending: true });

    if (typeof year === "string" && /^\d{4}$/.test(year)) {
      query = query.gte("holiday_date", `${year}-01-01`).lte("holiday_date", `${year}-12-31`);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return res.status(200).json({ holidays: (data || []).map(toApiRow) });
  } catch (err: any) {
    console.error("dashboard/holidays GET error:", err?.message || err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const { countryCode, date, name } = (req.body || {}) as {
    countryCode?: string;
    date?: string;
    name?: string;
  };

  if (!isCountryCode(countryCode)) return res.status(400).json({ error: "countryCode must be SG or MY" });
  if (!isValidDate(date)) return res.status(400).json({ error: "date must be YYYY-MM-DD" });
  if (!name || !name.trim()) return res.status(400).json({ error: "name is required" });

  try {
    const { data, error } = await supabaseAdmin()
      .from("public_holidays")
      .insert({
        country_code: countryCode,
        holiday_date: date,
        name: name.trim(),
        last_updated: new Date().toISOString(),
        editor_name: EDITOR_NAME,
      } as any)
      .select("id, country_code, holiday_date, name, last_updated, editor_name")
      .single();
    if (error) {
      if (error.code === "23505") {
        return res.status(409).json({ error: `A ${countryCode} holiday already exists on ${date}` });
      }
      throw new Error(error.message);
    }
    const { result: refresh, error: refreshError } = await tryRefreshBoth();
    return res.status(200).json({ holiday: toApiRow(data), refresh, ...(refreshError ? { refreshError } : {}) });
  } catch (err: any) {
    console.error("dashboard/holidays POST error:", err?.message || err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
}

async function handlePatch(req: NextApiRequest, res: NextApiResponse) {
  const { id, countryCode, date, name } = (req.body || {}) as {
    id?: string;
    countryCode?: string;
    date?: string;
    name?: string;
  };

  if (!id) return res.status(400).json({ error: "id is required" });
  if (countryCode !== undefined && !isCountryCode(countryCode)) {
    return res.status(400).json({ error: "countryCode must be SG or MY" });
  }
  if (date !== undefined && !isValidDate(date)) return res.status(400).json({ error: "date must be YYYY-MM-DD" });
  if (name !== undefined && !name.trim()) return res.status(400).json({ error: "name cannot be empty" });

  const patch: Record<string, any> = { last_updated: new Date().toISOString(), editor_name: EDITOR_NAME };
  if (countryCode !== undefined) patch.country_code = countryCode;
  if (date !== undefined) patch.holiday_date = date;
  if (name !== undefined) patch.name = name.trim();

  try {
    const lockError = await checkEditable(id);
    if (lockError) return res.status(lockError.status).json({ error: lockError.error });

    const { data, error } = await (supabaseAdmin().from("public_holidays") as any)
      .update(patch)
      .eq("id", id)
      .select("id, country_code, holiday_date, name, last_updated, editor_name")
      .single();
    if (error) {
      if (error.code === "23505") {
        return res.status(409).json({ error: "A holiday already exists for that country and date" });
      }
      throw new Error(error.message);
    }

    const { result: refresh, error: refreshError } = await tryRefreshBoth();
    return res.status(200).json({ holiday: toApiRow(data), refresh, ...(refreshError ? { refreshError } : {}) });
  } catch (err: any) {
    console.error("dashboard/holidays PATCH error:", err?.message || err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
}

async function handleDelete(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;
  if (typeof id !== "string") return res.status(400).json({ error: "id is required" });

  try {
    const lockError = await checkEditable(id);
    if (lockError) return res.status(lockError.status).json({ error: lockError.error });

    const { error } = await supabaseAdmin().from("public_holidays").delete().eq("id", id);
    if (error) throw new Error(error.message);

    const { result: refresh, error: refreshError } = await tryRefreshBoth();
    return res.status(200).json({ success: true, refresh, ...(refreshError ? { refreshError } : {}) });
  } catch (err: any) {
    console.error("dashboard/holidays DELETE error:", err?.message || err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
