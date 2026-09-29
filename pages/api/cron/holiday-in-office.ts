// pages/api/cron/holiday-in-office.ts
//
// Vercel Cron job (see vercel.json) — runs once daily at 00:00 SGT/MYT. Route
// path kept as-is (it's the live registered Cron schedule in vercel.json)
// even though the job now does more than holidays: reset managed SG/MY users
// -> apply public holiday -> apply active leave.
//
// This is the ONLY caller of runDailyStatusRefresh() (lib/dailyStatusRefresh.ts)
// — the only place that resets anyone. The daytime "Run update now" button
// (pages/api/dashboard/holidays/run.ts) deliberately calls a different,
// non-resetting function (runHolidayStatusRefresh) so the two never collide.

import type { NextApiRequest, NextApiResponse } from "next";
import { runDailyStatusRefresh } from "../../../lib/dailyStatusRefresh";

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
    const result = await runDailyStatusRefresh();
    console.log("cron/holiday-in-office", result);
    return res.status(200).json(result);
  } catch (err: any) {
    console.error("cron/holiday-in-office error:", err?.message || err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
