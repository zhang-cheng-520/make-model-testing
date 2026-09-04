import type { NextApiRequest, NextApiResponse } from "next";

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const { customerId, issue } = req.body;

  if (!customerId || !issue) {
    return res.status(400).json({
      error: "Missing customerId or issue",
    });
  }

  return res.status(200).json({
    ticketNumber: "SUP-1001",
    status: "Created",
  });
}