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
    console.log("DEBUG full payload:", JSON.stringify(body, null, 2));

    // Extract pol_number
    const pol_number = body?.QueueItems?.[0]?.SpecificContent?.pol_number;
    console.log("Extracted pol_number:", pol_number);

    if (!pol_number) {
      console.warn("⚠️ pol_number not found in payload:", body);
      // ✅ Still return 200 so UiPath doesn't retry
      return res.status(200).json({ warning: "Missing pol_number" });
    }

    // 🔄 Forward to Maestro
    const forwardPayload = { pol_number, ...body.QueueItems?.[0]?.SpecificContent };

    const forwardRes = await fetch(MAESTRO_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(UIPATH_BEARER ? { Authorization: `Bearer ${UIPATH_BEARER}` } : {}),
      },
      body: JSON.stringify(forwardPayload),
    });

    console.log("✅ Forwarded to Maestro, status:", forwardRes.status);

    // Don’t force-read body; just log if available
    let maestroResponse: any = null;
    try {
      if (forwardRes.headers.get("content-type")?.includes("application/json")) {
        maestroResponse = await forwardRes.json();
      } else {
        maestroResponse = await forwardRes.text();
      }
    } catch (err) {
      console.warn("⚠️ Could not read Maestro response:", err);
    }

    // ✅ Always return 200 OK to UiPath
    return res.status(200).json({
      message: "Webhook processed",
      pol_number,
      maestroStatus: forwardRes.status,
      maestroResponse,
    });
  } catch (err: any) {
    console.error("❌ Webhook error:", err);
    // Still respond 200 to avoid UiPath retry loops
    return res.status(200).json({ error: String(err) });
  }
}
