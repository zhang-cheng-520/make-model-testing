import type { NextApiRequest, NextApiResponse } from "next";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // wait for 15 seconds
  await sleep(15000);

  res.status(200).json({ value: "test" });
}
