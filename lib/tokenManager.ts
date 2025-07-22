// lib/tokenManager.ts
import { getEdgeValue } from './edgeConfigClient';
import { updateEdgeConfig } from './edgeConfigWriter';

export interface TokenData {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp (seconds)
}

// In-memory fallback for server environment
let inMemoryFallbackToken: TokenData | null = null;

const fallbackStore = {
  get: (): TokenData | null => inMemoryFallbackToken,
  set: (data: TokenData | null) => {
    inMemoryFallbackToken = data;
  },
};

/**
 * Retrieve token data, falling back if Edge Config is unavailable
 */
export async function getTokenData(): Promise<TokenData | null> {
  try {
    const edgeData = await getEdgeValue<TokenData>('teamsToken');
    if (edgeData) return edgeData;
    return fallbackStore.get();
  } catch (error) {
    console.error('Token retrieval failed:', error);
    return fallbackStore.get();
  }
}

/**
 * Save token data, validating structure and falling back on failure
 */
export async function saveTokenData(data: TokenData): Promise<void> {
  if (
    !data?.accessToken ||
    !data?.refreshToken ||
    !data?.expiresAt ||
    data.expiresAt < Math.floor(Date.now() / 1000)
  ) {
    throw new Error('Invalid token data or expired token');
  }

  try {
    await updateEdgeConfig([
      {
        operation: 'upsert',
        key: 'teamsToken',
        value: {
          ...data,
          // Ensure minimum 5 minutes expiry from now
          expiresAt: Math.max(data.expiresAt, Math.floor(Date.now() / 1000) + 300),
        },
      },
    ]);
  } catch (error) {
    console.error('Primary token save failed, using fallback:', error);
    fallbackStore.set(data);
    throw new Error('Failed to save token to Edge Config; fallback used');
  }
}

/**
 * Clear token data from Edge Config and fallback store
 */
export async function clearTokens(): Promise<void> {
  try {
    await updateEdgeConfig([{ operation: 'delete', key: 'teamsToken' }]);
  } catch (error) {
    console.error('Failed to clear Edge Config tokens:', error);
  }
  fallbackStore.set(null);
}
