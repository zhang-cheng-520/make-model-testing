// lib/edgeConfigWriter.ts

interface EdgeConfigWriteItem {
  key: string;
  value: any;
}

export async function updateEdgeConfig(items: EdgeConfigWriteItem[]) {
  const EDGE_CONFIG_ID = process.env.EDGE_CONFIG_ID;
  const VERCEL_TOKEN = process.env.VERCEL_EDGE_CONFIG_TOKEN;
  const TEAM_ID = process.env.VERCEL_TEAM_ID; // optional

  if (!EDGE_CONFIG_ID || !VERCEL_TOKEN) {
    throw new Error('Missing EDGE_CONFIG_ID or VERCEL_EDGE_CONFIG_TOKEN in env');
  }

  const url = `https://api.vercel.com/v1/edge-config/${EDGE_CONFIG_ID}/items${
    TEAM_ID ? `?teamId=${TEAM_ID}` : ''
  }`;

  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${VERCEL_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ items }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Failed to update Edge Config: ${err}`);
  }

  return await response.json();
}
