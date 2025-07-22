// lib/tokenManager.ts
import { getEdgeValue } from './edgeConfigClient';
import { updateEdgeConfig } from './edgeConfigWriter';

export interface TokenData {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp (seconds)
}

// Local storage fallback for critical failures
const localStorageFallback = {
  get: (): TokenData | null => {
    try {
      const data = localStorage.getItem('teamsTokenBackup');
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  },
  set: (data: TokenData) => {
    try {
      localStorage.setItem('teamsTokenBackup', JSON.stringify(data));
    } catch (error) {
      console.error('LocalStorage fallback failed:', error);
    }
  },
};

/**
 * Retrieves token data with fallback handling
 */
export async function getTokenData(): Promise<TokenData | null> {
  try {
    // Try Edge Config first
    const edgeData = await getEdgeValue<TokenData>('teamsToken');
    if (edgeData) return edgeData;

    // Fallback to localStorage
    return localStorageFallback.get();
  } catch (error) {
    console.error('Token retrieval failed:', error);
    return localStorageFallback.get();
  }
}

/**
 * Saves token data with validation and fallback
 */
export async function saveTokenData(data: TokenData): Promise<void> {
  // Validate token structure
  if (
    !data?.accessToken ||
    !data?.refreshToken ||
    !data?.expiresAt ||
    data.expiresAt < Math.floor(Date.now() / 1000)
  ) {
    throw new Error('Invalid token data format or expired token');
  }

  try {
    // Primary save to Edge Config
    await updateEdgeConfig([
      {
        operation: 'upsert',
        key: 'teamsToken',
        value: {
          ...data,
          // Ensure minimum 5 minute expiry
          expiresAt: Math.max(
            data.expiresAt,
            Math.floor(Date.now() / 1000) + 300
          ),
        },
      },
    ]);
  } catch (error) {
    console.error('Primary token save failed, using fallback:', error);
    localStorageFallback.set(data);
    throw new Error(
      'Failed to save token to Edge Config. Using local fallback.'
    );
  }
}

/**
 * Emergency token cleanup
 */
export async function clearTokens(): Promise<void> {
  try {
    await updateEdgeConfig([{ operation: 'delete', key: 'teamsToken' }]);
  } catch (error) {
    console.error('Failed to clear Edge Config tokens:', error);
  }
  localStorageFallback.set(null);
}