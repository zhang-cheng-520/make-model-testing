import type { NextApiRequest, NextApiResponse } from "next";
import { assertUipathConfigured, getResolvedGroupMembers } from "../../../../../lib/uipath";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Use GET" });
  const { groupId } = req.query;
  if (typeof groupId !== "string") return res.status(400).json({ error: "groupId is required" });

  try {
    assertUipathConfigured();
    const members = await getResolvedGroupMembers(groupId);
    return res.status(200).json({ members: members.filter((m) => m.email) });
  } catch (err: any) {
    console.error("dashboard/groups/[groupId]/members error:", err?.message || err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
