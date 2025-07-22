// lib/edgeConfigClient.ts
import { createClient } from '@vercel/edge-config';

const CONNECTION_STRING =
  'ecfg_zdtspifap2vajlkj5lsxiocrnhyv?token=0e164c4f-b849-4967-bdf5-18da7305d6e4';

function validateConnectionString(str: string) {
  if (!str.includes('ecfg_') || !str.includes('?token=')) {
    throw new Error(
      `Invalid Edge Config format. Must contain 'ecfg_' and '?token='`
    );
  }
}

async function initializeEdgeConfig() {
  try {
    validateConnectionString(CONNECTION_STRING);
    const client = createClient(CONNECTION_STRING);

    // Quick test
    await client.get('teamsToken');
    console.log('✅ Edge Config client initialized');
    return client;
  } catch (error) {
    console.error('⚠️ Official Edge Config client failed, using fallback');

    const fallbackUrl = `https://edge-config.vercel.com/${CONNECTION_STRING}`;
    return {
      get: async <T>(key: string): Promise<T | null> => {
        try {
          const res = await fetch(fallbackUrl);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();

          if (data?.items && Object.prototype.hasOwnProperty.call(data.items, key)) {
            return data.items[key] as T;
          }

          return null;
        } catch (err) {
          console.error(`Fallback fetch failed for key "${key}"`, err);
          return null;
        }
      },
    };
  }
}

const edgeConfig = initializeEdgeConfig();

export async function getEdgeValue<T>(key: string): Promise<T | null> {
  return (await edgeConfig).get(key);
}
