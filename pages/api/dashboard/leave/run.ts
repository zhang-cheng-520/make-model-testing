// pages/api/dashboard/leave/run.ts
//
// On-demand trigger for the LOA Management Portal's "Run update now" button
// — calls runLeaveStatusRefresh() (lib/dailyStatusRefresh.ts), NOT
// runHolidayStatusRefresh(). Deliberately narrower: only ever touches people
// who currently have a leave_periods row — never a whole SG/MY group's
// Public Holiday status the way the Public Holidays page's button does.
// Protected by middleware.ts like every other /api/dashboard/* route.
//
// Contract:
//   POST /api/dashboard/leave/run
//   -> 200 { date, affectedCount, managedCount, activeCount, results: [...] }
//      (see lib/dailyStatusRefresh.ts)

import type { NextApiRequest, NextApiResponse } from "next";
import { runLeaveStatusRefresh } from "../../../../lib/dailyStatusRefresh";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  try {
    const result = await runLeaveStatusRefresh();
    console.log("dashboard/leave/run", result);
    return res.status(200).json(result);
  } catch (err: any) {
    console.error("dashboard/leave/run error:", err?.message || err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
