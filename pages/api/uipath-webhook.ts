// pages/api/uipath-webhook.ts
import type { NextApiRequest, NextApiResponse } from "next";

const MAESTRO_URL = process.env.MAESTRO_URL!;
const UIPATH_BEARER = process.env.UIPATH_BEARER_TOKEN;

export const config = {
  api: {
    bodyParser: true, // ✅ Next.js parses JSON automatically
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = req.body;
    console.log("📩 Webhook payload received:", body);

    // Extract pol_number
    const pol_number = body?.QueueItem?.SpecificContent?.pol_number;

    if (!pol_number) {
      console.warn("⚠️ pol_number not found in payload:", body);
      return res.status(400).json({ error: "Missing pol_number" });
    }

    // 🔄 Forward to Maestro
    const forwardRes = await fetch(MAESTRO_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(UIPATH_BEARER ? { Authorization: `Bearer ${UIPATH_BEARER}` } : {}),
      },
      body: JSON.stringify({ pol_number, ...body.QueueItem.SpecificContent }),
    });

    let maestroResponse: any;
    try {
      maestroResponse = await forwardRes.json();
    } catch {
      maestroResponse = await forwardRes.text();
    }

    console.log("✅ Forwarded to Maestro with pol_number:", pol_number);

    return res.status(200).json({
      message: "Webhook processed",
      pol_number,
      maestroResponse,
    });
  } catch (err: any) {
    console.error("❌ Webhook error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
