import type { NextApiRequest, NextApiResponse } from "next";

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  console.log("========================================");
  console.log("Verify Customer API Called");
  console.log("Time:", new Date().toISOString());
  console.log("Method:", req.method);
  console.log("URL:", req.url);
  console.log("Headers:", JSON.stringify(req.headers, null, 2));
  console.log("Body:", JSON.stringify(req.body, null, 2));
  console.log("========================================");

  if (req.method !== "POST") {
    console.log("❌ Invalid HTTP Method");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const { fullName, policyNumber, dateOfBirth } = req.body;

  const verified =
    fullName === "John Tan" &&
    policyNumber === "POL123456" &&
    dateOfBirth === "1990-01-01";

  console.log("Verification Result:", verified);

  if (verified) {
    const response = {
      verified: true,
      customerId: "CUST001",
    };

    console.log("Response:", JSON.stringify(response, null, 2));
    console.log("========================================");

    return res.status(200).json(response);
  }

  const response = {
    verified: false,
    customerId: null,
  };

  console.log("Response:", JSON.stringify(response, null, 2));
  console.log("========================================");

  return res.status(200).json(response);
}