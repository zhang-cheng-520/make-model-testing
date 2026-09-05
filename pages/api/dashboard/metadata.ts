import type { NextApiRequest, NextApiResponse } from "next";
import { supabaseAdmin } from "../../../lib/supabaseAdmin";
import { isValidCategory } from "../../../lib/categories";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") return handleGet(req, res);
  if (req.method === "PATCH") return handlePatch(req, res);
  return res.status(405).json({ error: "Use GET or PATCH" });
}

// GET /api/dashboard/metadata?ids=id1,id2,id3
async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const idsParam = req.query.ids;
  const ids = (typeof idsParam === "string" ? idsParam.split(",") : []).map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) return res.status(200).json({ rows: [] });

  try {
    const { data, error } = await supabaseAdmin()
      .from("user_metadata")
      .select("uipath_id, in_office, categories, updated_at")
      .in("uipath_id", ids);
    if (error) throw new Error(error.message);
    return res.status(200).json({ rows: data || [] });
  } catch (err: any) {
    console.error("dashboard/metadata GET error:", err?.message || err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
}

// PATCH { uipathId, email?, inOffice?, categories? }
async function handlePatch(req: NextApiRequest, res: NextApiResponse) {
  const { uipathId, email, inOffice, categories } = (req.body || {}) as {
    uipathId?: string;
    email?: string;
    inOffice?: boolean;
    categories?: string[];
  };

  if (!uipathId) return res.status(400).json({ error: "uipathId is required" });

  if (categories) {
    const invalid = categories.filter((c) => !isValidCategory(c));
    if (invalid.length > 0) {
      return res.status(400).json({ error: `Invalid categories: ${invalid.join(", ")}` });
    }
  }

  try {
    const row: Record<string, any> = {
      uipath_id: uipathId,
      updated_at: new Date().toISOString(),
    };
    if (email !== undefined) row.email = email;
    if (inOffice !== undefined) row.in_office = inOffice;
    if (categories !== undefined) row.categories = categories;

    const { data, error } = await supabaseAdmin()
      .from("user_metadata")
      .upsert(row as any, { onConflict: "uipath_id" })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return res.status(200).json({ row: data });
  } catch (err: any) {
    console.error("dashboard/metadata PATCH error:", err?.message || err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
