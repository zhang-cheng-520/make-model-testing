import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";
import getRawBody from "raw-body";

const UIPATH_WEBHOOK_SECRET = process.env.UIPATH_WEBHOOK_SECRET || "SuperSecret?";
const MAESTRO_URL =
  "https://cloud.uipath.com/ecicspxytrvx/DefaultTenant/orchestrator_/t/38952a63-0708-4971-8831-cf84d5dbe7d9/rpaBPMN";
const UIPATH_BEARER = process.env.UIPATH_BEARER_TOKEN;

export const config = {
  api: {
    bodyParser: false, // 👈 disable body parsing for raw HMAC check
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // ✅ Capture raw body
    const rawBody = (await getRawBody(req)).toString("utf8");

    // ✅ Verify HMAC signature
    const signature = req.headers["x-uipath-signature"] as string;
    if (!signature) return res.status(401).json({ error: "Missing signature" });

    const hmac = crypto.createHmac("sha256", UIPATH_WEBHOOK_SECRET);
    hmac.update(rawBody);
    const computedSignature = hmac.digest("base64");

    const sigBuf = Buffer.from(signature);
    const compBuf = Buffer.from(computedSignature);

    if (sigBuf.length !== compBuf.length || !crypto.timingSafeEqual(sigBuf, compBuf)) {
      return res.status(401).json({ error: "Invalid signature" });
    }

    // ✅ Parse JSON body AFTER signature validation
    const body = JSON.parse(rawBody);

    // ✅ Extract pol_number
    const pol_number = body?.SpecificContent?.pol_number || body?.InputArguments?.pol_number;
    if (!pol_number) {
      console.warn("pol_number not found in webhook payload:", body);
      return res.status(400).json({ error: "Missing pol_number" });
    }

    // 🔄 Forward to Maestro BPMN API Trigger
    const forwardRes = await fetch(MAESTRO_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${UIPATH_BEARER}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ pol_number }),
    });

    const data = await forwardRes.json();
    console.log("Forwarded to Maestro:", data);

    return res.status(200).json({ message: "Webhook processed", maestroResponse: data });
  } catch (err: any) {
    console.error("Webhook error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
