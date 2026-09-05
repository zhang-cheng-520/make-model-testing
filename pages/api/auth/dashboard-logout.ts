import type { NextApiRequest, NextApiResponse } from "next";
import { clearSessionCookie } from "../../../lib/dashboardAuth";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
  clearSessionCookie(res);
  return res.status(200).json({ ok: true });
}
