// lib/tokenManager.ts
import { getEdgeValue } from './edgeConfigClient';
import { updateEdgeConfig } from './edgeConfigWriter';

interface TokenData {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp (seconds)
}

export async function getTokenData(): Promise<TokenData | null> {
  return await getEdgeValue<TokenData>('teamsToken');
}

export async function saveTokenData(data: TokenData): Promise<void> {
  await updateEdgeConfig([{ key: 'teamsToken', value: data }]);
}
