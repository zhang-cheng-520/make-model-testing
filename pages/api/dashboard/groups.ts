import type { NextApiRequest, NextApiResponse } from "next";
import { assertUipathConfigured, getCustomGroups } from "../../../lib/uipath";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Use GET" });
  try {
    assertUipathConfigured();
    const groups = await getCustomGroups();
    return res.status(200).json({
      groups: groups.map((g) => ({ id: g.id, name: g.name, displayName: g.displayName })),
    });
  } catch (err: any) {
    console.error("dashboard/groups error:", err?.message || err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
