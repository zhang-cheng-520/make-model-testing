// pages/api/dashboard/holidays/run.ts
//
// On-demand trigger for the public-holiday In-Office sweep
// (lib/holidayInOfficeSweep.ts) — lets the Public Holidays dashboard page
// test the automation immediately (e.g. right after adding a test holiday
// dated today) instead of waiting for the daily Vercel Cron tick. Protected
// by middleware.ts like every other /api/dashboard/* route — no separate
// CRON_SECRET check needed here.
//
// Contract:
//   POST /api/dashboard/holidays/run
//   -> 200 { date, sg: {...}, my: {...} }  (see lib/holidayInOfficeSweep.ts)

import type { NextApiRequest, NextApiResponse } from "next";
import { runHolidayInOfficeSweep } from "../../../../lib/holidayInOfficeSweep";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  try {
    const result = await runHolidayInOfficeSweep();
    console.log("dashboard/holidays/run", result);
    return res.status(200).json(result);
  } catch (err: any) {
    console.error("dashboard/holidays/run error:", err?.message || err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
