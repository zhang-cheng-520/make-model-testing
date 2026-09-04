import type { NextApiRequest, NextApiResponse } from "next";

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const { customerId } = req.body;

  if (customerId !== "CUST001") {
    return res.status(404).json({
      error: "Customer not found",
    });
  }

  return res.status(200).json({
    policyNumber: "POL123456",
    policyType: "Motor Insurance",
    status: "Active",
    renewalDate: "2025-12-15",
    premium: 1200,
    coverage: "Comprehensive",
  });
}