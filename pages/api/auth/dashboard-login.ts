import type { NextApiRequest, NextApiResponse } from "next";
import { checkCredentials, createSessionToken, setSessionCookie } from "../../../lib/dashboardAuth";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  const { email, password } = (req.body || {}) as { email?: string; password?: string };
  if (!email || !password) return res.status(400).json({ error: "email and password are required" });

  if (!checkCredentials(email, password)) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const token = await createSessionToken();
  setSessionCookie(res, token);
  return res.status(200).json({ ok: true });
}
