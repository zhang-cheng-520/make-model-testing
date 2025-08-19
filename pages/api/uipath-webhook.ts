// pages/api/uipath-webhook.ts
import type { NextApiRequest, NextApiResponse } from "next";

const MAESTRO_URL = process.env.MAESTRO_URL!;

export const config = {
  api: {
    bodyParser: true, // ✅ let Next.js parse JSON automatically
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = req.body;
    console.log("📩 Webhook payload:", body);

    let pol_number: string | undefined;

    if (body?.QueueItem) {
      pol_number = body.QueueItem.SpecificContent?.pol_number;
    } else if (body?.QueueItems?.length > 0) {
      pol_number = body.QueueItems[0]?.SpecificContent?.pol_number;
    } else {
      pol_number = body?.SpecificContent?.pol_number || body?.InputArguments?.pol_number;
    }

    if (!pol_number) {
      console.warn("⚠️ pol_number not found in payload:", body);
      return res.status(400).json({ error: "Missing pol_number" });
    }

    // 🔄 Forward to Maestro
    const forwardRes = await fetch(MAESTRO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pol_number }),
    });

    let maestroResponse: any;
    try {
      maestroResponse = await forwardRes.json();
    } catch {
      maestroResponse = await forwardRes.text();
    }

    console.log("✅ Forwarded to Maestro:", pol_number);

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
