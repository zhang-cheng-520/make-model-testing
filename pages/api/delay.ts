// pages/api/delay-test.js
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method Not Allowed" });
  }

  // Random delay between 5–10 seconds
  const delay = Math.floor(Math.random() * 5000) + 5000;

  // Wait for that delay
  await new Promise(resolve => setTimeout(resolve, delay));

  // Respond after delay
  res.status(200).json({
    message: "Response after random delay",
    delayMs: delay,
    method: req.method,
  });
}
