import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";

// Secrets and tokens
const UIPATH_WEBHOOK_SECRET = process.env.UIPATH_WEBHOOK_SECRET || "SuperSecret?";
const MAESTRO_URL =
  "https://cloud.uipath.com/ecicspxytrvx/DefaultTenant/orchestrator_/t/38952a63-0708-4971-8831-cf84d5dbe7d9/rpaBPMN";
const UIPATH_BEARER = process.env.UIPATH_BEARER_TOKEN;

async function getRawBody(req: any): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export const config = {
  api: {
    bodyParser: false, // 👈 needed for HMAC validation
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // ✅ Get raw body
    const rawBody = await getRawBody(req);

    // ✅ Verify signature
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

    // ✅ Parse JSON AFTER validation
    const body = JSON.parse(rawBody);

    // ✅ Extract pol_number safely
    let pol_number: string | undefined;
    if (body?.QueueItems?.length > 0) {
      pol_number = body.QueueItems[0]?.SpecificContent?.pol_number;
    } else {
      pol_number = body?.SpecificContent?.pol_number || body?.InputArguments?.pol_number;
    }

    if (!pol_number) {
      console.warn("pol_number not found in webhook payload:", body);
      return res.status(400).json({ error: "Missing pol_number" });
    }

    // 🔄 Forward to Maestro BPMN API
    const forwardRes = await fetch(MAESTRO_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${UIPATH_BEARER}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ pol_number }),
    });

    const data = await forwardRes.json();
    console.log("✅ Forwarded to Maestro with pol_number:", pol_number, data);

    return res.status(200).json({
      message: "Webhook processed",
      pol_number,
      maestroResponse: data,
    });
  } catch (err: any) {
    console.error("❌ Webhook error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
