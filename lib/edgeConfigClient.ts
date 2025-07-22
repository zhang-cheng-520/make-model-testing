// lib/edgeConfigClient.ts
import { createClient } from '@vercel/edge-config';

const CONNECTION_STRING = "ecfg_zdtspifap2vajlkj5lsxiocrnhyv?token=70f39dde-3f0a-46ca-9e5b-7290a9825ac5";

// More lenient validation
function validateConnectionString(str: string) {
  if (!str.includes('ecfg_') || !str.includes('?token=')) {
    throw new Error(`Invalid Edge Config format. Must contain 'ecfg_' and '?token='`);
  }
}

async function initializeEdgeConfig() {
  try {
    validateConnectionString(CONNECTION_STRING);
    const client = createClient(CONNECTION_STRING);
    
    // Quick test query
    await client.get('teamsToken');
    console.log('✅ Edge Config client initialized');
    return client;
  } catch (error) {
    console.error('⚠️ Official Edge Config client failed, using fallback');
    return {
      get: async <T>(key: string): Promise<T | null> => {
        const res = await fetch(`https://edge-config.vercel.com/${CONNECTION_STRING}`);
        const data = await res.json();
        return data.items[key] || null;
      }
    };
  }
}

const edgeConfig = initializeEdgeConfig();

export async function getEdgeValue<T>(key: string): Promise<T | null> {
  return (await edgeConfig).get(key);
}