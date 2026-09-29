// pages/api/dashboard/holidays/run.ts
//
// On-demand, daytime PH refresh for the Public Holidays dashboard page's
// "Run update now" button — calls runHolidayStatusRefresh() (lib/dailyStatusRefresh.ts),
// NOT the scheduled runDailyStatusRefresh(). This is a deliberately different
// function: it recomputes both countries' managed users directly (LOA >
// Public Holiday > Normal) without the blanket reset step the 00:00 cron
// does, so it's safe to click at any time of day without disturbing
// unrelated state. Protected by middleware.ts like every other
// /api/dashboard/* route — no separate CRON_SECRET check needed here.
//
// Contract:
//   POST /api/dashboard/holidays/run
//   -> 200 { date, sg: CountryRefreshResult, my: CountryRefreshResult }
//      (see lib/dailyStatusRefresh.ts)

import type { NextApiRequest, NextApiResponse } from "next";
import { runHolidayStatusRefresh } from "../../../../lib/dailyStatusRefresh";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  try {
    const result = await runHolidayStatusRefresh();
    console.log("dashboard/holidays/run", result);
    return res.status(200).json(result);
  } catch (err: any) {
    console.error("dashboard/holidays/run error:", err?.message || err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
