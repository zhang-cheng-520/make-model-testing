// pages/api/cron/holiday-in-office.ts
//
// Vercel Cron job (see vercel.json) — runs once daily. Sweep logic lives in
// lib/holidayInOfficeSweep.ts, shared with the on-demand trigger at
// pages/api/dashboard/holidays/run.ts (used for testing from the Public
// Holidays dashboard page) so the two never drift apart.

import type { NextApiRequest, NextApiResponse } from "next";
import { runHolidayInOfficeSweep } from "../../../lib/holidayInOfficeSweep";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Use GET or POST" });
  }

  // Vercel automatically sends this header for its own Cron invocations when
  // CRON_SECRET is set — same check Vercel's docs recommend to stop anyone
  // else from hitting the endpoint. https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  try {
    const result = await runHolidayInOfficeSweep();
    console.log("cron/holiday-in-office", result);
    return res.status(200).json(result);
  } catch (err: any) {
    console.error("cron/holiday-in-office error:", err?.message || err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
