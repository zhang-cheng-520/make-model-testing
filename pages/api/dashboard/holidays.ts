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
//   PATCH  /api/dashboard/holidays        body: { id, countryCode?, date?, name? }
//   DELETE /api/dashboard/holidays?id=...
//
// editor_name is not client-supplied — v1 login is one shared account (no
// per-user identity, same limitation as user_metadata.updated_by, see
// docs/PRD-hr-dashboard.md §5.5), so every write is stamped with the shared
// DASHBOARD_LOGIN_EMAIL rather than a free-typed name.

import type { NextApiRequest, NextApiResponse } from "next";
import { supabaseAdmin } from "../../../lib/supabaseAdmin";

const EDITOR_NAME = process.env.DASHBOARD_LOGIN_EMAIL || "dashboard";

const COUNTRY_CODES = ["SG", "MY"] as const;
type CountryCode = (typeof COUNTRY_CODES)[number];

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
    return res.status(200).json({ holiday: toApiRow(data) });
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
    return res.status(200).json({ holiday: toApiRow(data) });
  } catch (err: any) {
    console.error("dashboard/holidays PATCH error:", err?.message || err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
}

async function handleDelete(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;
  if (typeof id !== "string") return res.status(400).json({ error: "id is required" });

  try {
    const { error } = await supabaseAdmin().from("public_holidays").delete().eq("id", id);
    if (error) throw new Error(error.message);
    return res.status(200).json({ success: true });
  } catch (err: any) {
    console.error("dashboard/holidays DELETE error:", err?.message || err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
