import { getEdgeValue } from './edgeConfigClient';
import { updateEdgeConfig } from './edgeConfigWriter';

export interface TokenData {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp (seconds)
}

// In-memory cache for token data
let cachedTokenData: TokenData | null = null;

/**
 * Retrieve token data, using in-memory cache if valid,
 * otherwise fetch from Edge Config and update cache
 */
export async function getTokenData(): Promise<TokenData | null> {
  const now = Math.floor(Date.now() / 1000);

  // Return cached token if it exists and is still valid (not expired)
  if (cachedTokenData && cachedTokenData.expiresAt > now) {
    return cachedTokenData;
  }

  try {
    const edgeData = await getEdgeValue<TokenData>('teamsToken');
    if (edgeData && edgeData.expiresAt > now) {
      cachedTokenData = edgeData; // Update cache
      return edgeData;
    }
  } catch (error) {
    console.error('Token retrieval from Edge Config failed:', error);
  }

  // Return cached token even if expired or null if no cache
  return cachedTokenData;
}

/**
 * Save token data to Edge Config and update in-memory cache
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
    // Update cache immediately after successful save
    cachedTokenData = data;
  } catch (error) {
    console.error('Primary token save failed, using fallback:', error);
    cachedTokenData = data; // fallback cache update
    throw new Error('Failed to save token to Edge Config; fallback used');
  }
}

/**
 * Clear token data from Edge Config and in-memory cache
 */
export async function clearTokens(): Promise<void> {
  try {
    await updateEdgeConfig([{ operation: 'delete', key: 'teamsToken' }]);
  } catch (error) {
    console.error('Failed to clear Edge Config tokens:', error);
  }
  cachedTokenData = null;
}
