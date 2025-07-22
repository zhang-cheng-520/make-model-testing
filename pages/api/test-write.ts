// pages/api/test-token-flow.ts
import { getTokenData, saveTokenData } from '../../lib/tokenManager';

export default async function handler(req, res) {
  try {
    // Test save
    await saveTokenData({
      accessToken: 'ddd' + Date.now(),
      refreshToken: 'ddd' + Date.now(),
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    });

    // Test retrieval
    const tokens = await getTokenData();

    res.status(200).json({
      success: true,
      tokens: {
        ...tokens,
        accessToken: tokens?.accessToken?.slice(0, 5) + '...',
        refreshToken: tokens?.refreshToken?.slice(0, 5) + '...',
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}