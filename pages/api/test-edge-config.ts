// pages/api/test-edge-config.ts
import { getEdgeValue } from '../../lib/edgeConfigClient';
import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    // Test with a known key
    const value = await getEdgeValue<{
      accessToken: string;
      refreshToken: string;
      expiresAt: number;
    }>('teamsToken');

    if (!value) {
      throw new Error('No value returned from Edge Config');
    }

    res.status(200).json({
      success: true,
      data: {
        accessToken: value.accessToken ,
        refreshToken: value.refreshToken ,
        expiresAt: value.expiresAt
      }
    });

  } catch (error: any) {
    console.error('Test endpoint error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      diagnostics: {
        timestamp: new Date().toISOString(),
        connectionString: process.env.EDGE_CONFIG 
          ? '***REDACTED***' 
          : 'MISSING'
      }
    });
  }
}