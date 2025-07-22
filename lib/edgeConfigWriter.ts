// lib/edgeConfigWriter.ts
interface EdgeConfigWriteOperation {
  operation: 'upsert' | 'delete';
  key: string;
  value?: any;
}


export async function updateEdgeConfig(
  operations: EdgeConfigWriteOperation[]
): Promise<void> {
  // Validate environment variables
  if (!process.env.EDGE_CONFIG_ID || !process.env.VERCEL_ACCESS_TOKEN) {
    throw new Error(
      'Missing required env vars: EDGE_CONFIG_ID and VERCEL_ACCESS_TOKEN'
    );
  }

  const API_URL = `https://api.vercel.com/v1/edge-config/${process.env.EDGE_CONFIG_ID}/items`;

  try {
    const response = await fetch(API_URL, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${process.env.VERCEL_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ items: operations }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      console.error('Edge Config API Error:', {
        status: response.status,
        configId: process.env.EDGE_CONFIG_ID,
        operations,
        error,
      });
      throw new Error(
        `Edge Config update failed (HTTP ${response.status}): ${error.message || 'No error details'}`
      );
    }

    console.log('✅ Edge Config updated successfully');
  } catch (error) {
    console.error('Critical Edge Config Error:', error);
    throw error; // Re-throw for caller handling
  }
}