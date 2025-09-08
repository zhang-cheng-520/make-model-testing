import type { NextApiRequest, NextApiResponse } from "next";

// Hardcoded constants (POC mode)
const WEBSITE_ID = "a8481348-1a81-4614-822c-2d2317c76269";
const USERNAME = "f94db5b3-310b-44a1-bbec-6acf888e3531";
const PASSWORD = "f3202cca9da4c04a2eb9d102315dd1b8c685515c6009e0d1b6fe77028248c755";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST" });
  }

  try {
    const endpoint = `https://plugins.crisp.chat/urn:crisp.im:whatsapp:0/wa/api/website/${WEBSITE_ID}/template/send`;

    // Hardcoded message body
    const body = {
      message_template: {
        language: "en",
        name: "maid_campaign_msg_test",
        components: [
          {
            type: "BODY",
            parameters: [
              { type: "text", text: "Bro", parameter_name: "name" },
              { type: "text", text: "https://www.ecics.com/", parameter_name: "url" },
            ],
            text:
              "📣 Staff Exclusive: 50% OFF Maid Insurance + Referral Rewards! 📣\n \n" +
              "Hi {{name}}, exciting news! ✨\n \n" +
              "Get 50% off Maid Insurance with full coverage for accidents, injuries, and more. Plus, refer friends and family to win rewards in our referral campaign! 🎁\n \n" +
              "Don’t miss out — {{url}} to get your referral link and secure your policy today! 💼💰",
          },
          {
            type: "button",
            index: 0,
            parameters: [{ type: "text", text: "abcd123" }],
            sub_type: "URL",
            text: "Visit website",
          },
        ],
      },
      crisp_options: {
        type: "text",
        operator: {
          user_id: "4ec8f3d7-9a35-4a1b-94d0-59c9a79c5608",
          avatar:
            "https://storage.crisp.chat/users/avatar/operator/-/3/5/1/c/351cf78caf6e4a0/ecics-facebook-logo_365ult.png",
          email: "ecicsdial@ecics.com.sg",
          first_name: "ECICS",
          last_name: "Limited",
          locale: "",
          phone: "+6591474073",
        },
      },
      session_id: "session_f0cc16e9-8617-4f8b-8518-78a75c831b50",
      to_number: "+6597528242",
      from_number_id: "596919163509171",
    };

    const headers = {
      "Content-Type": "application/json",
      Authorization: "Basic " + Buffer.from(`${USERNAME}:${PASSWORD}`).toString("base64"),
    };

    const resp = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    const data = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      return res
        .status(resp.status)
        .json({ error: `Crisp API error ${resp.status} ${resp.statusText}`, details: data });
    }

    return res.status(200).json({ ok: true, data });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || String(err) });
  }
}
