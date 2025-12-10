import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * Convert a string to Title Case with exceptions for small words
 */
function toTitleCase(str: string): string {
  const lowercaseWords = [
    'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'if', 'in',
    'nor', 'of', 'on', 'or', 'so', 'the', 'to', 'up', 'yet'
  ];

  return str
    .toLowerCase()
    .split(' ')
    .map((word, index) => {
      if (index === 0 || !lowercaseWords.includes(word)) {
        return word.charAt(0).toUpperCase() + word.slice(1);
      }
      return word;
    })
    .join(' ');
}

/**
 * Parse the SQL-cleaned endorsement text into structured JSON
 */
function parseEndorsementsFromSQL(input: string): Record<string, string> {
  const result: Record<string, string> = {};

  // Step 1: Normalize and split using the // separators
  const parts = input
    .replace(/\s+/g, ' ') // collapse multiple spaces
    .replace(/\/{2,}/g, '//') // normalize multi-slash groups
    .split('//') // split sections
    .map(p => p.trim())
    .filter(p => p.startsWith('V')); // keep only lines that start with "V"

  // Step 2: Extract V-code and description from each section
  for (const part of parts) {
    const match = part.match(/^(V\d{4})\s*-\s*(.+)$/);
    if (match) {
      const code = match[1].trim();
      const description = toTitleCase(match[2].trim());
      result[code] = description;
    }
  }

  return result;
}

/**
 * GET /api/cleaner
 * Parses SQL-cleaned endorsement text into JSON
 */
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Simulate SQL response (this would come from your SELECT query)
  const sqlResponse =
    "THE FOLLOWING ENDORSEMENTS SHALL APPLY TO THIS POLICY :////V0003 - BREAKAGE OF GLASS IN WINDSCREEN OR WINDOW (SUN ROOF/MOON ROOF FOR PRIVATE CAR ONLY)//V0009 - FLOOD AND OTHER SPECIAL PERILS//V0010 - 24/7 ACCIDENT ASSISTANCE//V0012 - MARKET VALUE FOR THE PURPOSE OF TOTAL LOSS SETTLEMENT//V0014 - STRIKE RIOT AND CIVIL COMMOTION//V0017 - TOTAL LOSS//V0046 - WAIVER OF EXCESS CLAUSE - OWN DAMAGE CLAIM (SECTION I) FOR FIRST ACCIDENT CLAIM (INSURED OR NAMED DRIVERS ONLY) FOR AUTHORISED WORKSHOP PLAN//V0063 - YOUNG, AND INEXPERIENCED UNNAMED DRIVER EXCESS (FPS)";

  const parsed = parseEndorsementsFromSQL(sqlResponse);

  return res.status(200).json(parsed);
}
