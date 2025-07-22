// /lib/tokenManager.ts
import { get, set } from '@vercel/edge-config';

interface TokenData {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp (seconds)
}

export async function getTokenData(): Promise<TokenData | null> {
  return await get<TokenData>('teamsToken');
}

export async function saveTokenData(data: TokenData): Promise<void> {
  await set('teamsToken', data);
}