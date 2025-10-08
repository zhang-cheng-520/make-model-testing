// Ideally to use namelist from Sanction List
// pages/api/validate-loan.js
export default function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method Not Allowed" });
  }

  try {
    const { Name } = req.body;

    const blacklist = ["John Tan", "Ali Ahmad", "Mary Lim"];
    const cleanedName = (Name || "").trim().toLowerCase();
    const isBlacklisted = blacklist.some(
      x => x.toLowerCase() === cleanedName
    );

    const ValidationResult = isBlacklisted ? "Blacklisted" : "Approved";

    res.status(200).json({
      ValidationResult,
      receivedName: Name
    });
  } catch (error) {
    res.status(400).json({ error: "Invalid request", details: error.message });
  }
}
