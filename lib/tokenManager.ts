// lib/tokenManager.ts
import axios from 'axios';
import { getEdgeValue } from './services/edgeConfigClient';
import { updateEdgeConfig } from './services/edgeConfigWriter';

export interface TokenData {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

let cachedTokenData: TokenData | null = null;

export async function getTokenData(): Promise<TokenData | null> {
  const now = Math.floor(Date.now() / 1000);

  if (!cachedTokenData) {
    try {
      const edgeData = await getEdgeValue<TokenData>('teamsToken');
      if (edgeData) cachedTokenData = edgeData;
    } catch (error) {
      console.error('Token retrieval from Edge Config failed:', error);
    }
  }

  return cachedTokenData;
}

export async function refreshAccessToken(oldRefreshToken: string): Promise<TokenData> {
  if (!oldRefreshToken) {
    throw new Error('No refresh token available');
  }

  const response = await axios.post(
    `https://login.microsoftonline.com/${process.env.TENANT_ID}/oauth2/v2.0/token`,
    new URLSearchParams({
      client_id: process.env.CLIENT_ID!,
      client_secret: process.env.CLIENT_SECRET!,
      grant_type: 'refresh_token',
      refresh_token: oldRefreshToken,
      redirect_uri: process.env.REDIRECT_URI!,
      scope: 'ChannelMessage.Send Chat.ReadWrite offline_access',
    })
  );
  console.log(response.data)

  const newTokenData: TokenData = {
    accessToken: response.data.access_token,
    refreshToken: response.data.refresh_token,
    expiresAt: Math.floor(Date.now() / 1000) + 89 * 24 * 60 * 60, // 89 days (default setting of 90 days in Azure)
  };

  await saveTokenData(newTokenData); // Updates Edge Config and cache
  return newTokenData;
}

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
          // expiresAt: Math.max(data.expiresAt, Math.floor(Date.now() / 1000) + 300),
        },
      },
    ]);
    cachedTokenData = data;
  } catch (error) {
    console.error('Primary token save failed, using fallback:', error);
    cachedTokenData = data;
    throw new Error('Failed to save token to Edge Config; fallback used');
  }
}

export async function clearTokens(): Promise<void> {
  try {
    await updateEdgeConfig([{ operation: 'delete', key: 'teamsToken' }]);
  } catch (error) {
    console.error('Failed to clear Edge Config tokens:', error);
  }
  cachedTokenData = null;
}
