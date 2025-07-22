// pages/api/debug-env.ts
export default function handler(req, res) {
  res.status(200).json({
    EDGE_CONFIG: process.env.EDGE_CONFIG,
    // Add this to check for hidden characters
    raw: {
      length: process.env.EDGE_CONFIG?.length,
      first5: process.env.EDGE_CONFIG?.slice(0, 5),
      last5: process.env.EDGE_CONFIG?.slice(-5)
    }
  });
}