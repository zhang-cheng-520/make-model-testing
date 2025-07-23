// pages/api/test-write.ts
import { saveTokenData, getTokenData } from '../../lib/tokenManager';
import { getEdgeValue } from '../../lib/edgeConfigClient';

export default async function handler(req, res) {
  try {
    if (req.method === 'POST') {
      const { accessToken, refreshToken, expiresAt } = req.body;

      if (!accessToken || !refreshToken || !expiresAt) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: accessToken, refreshToken, expiresAt',
        });
      }

      await saveTokenData({
        accessToken,
        refreshToken,
        expiresAt,
      });

      return res.status(200).json({ success: true, message: 'Token saved.' });
    } else if (req.method === 'GET') {
      // Get current token data (from cache or edge config)
      const currentData = await getTokenData();

      if (!currentData) {
        return res.status(404).json({ success: false, error: 'No token data found' });
      }

      // Update expiresAt to new future timestamp (e.g., +10 mins)
      const updatedData = {
        ...currentData,
        expiresAt: Math.floor(Date.now() / 1000) + 600, // 10 minutes from now
      };

      // Save updated data back (this updates edge config and cache)
      await saveTokenData(updatedData);

      // Fetch fresh value directly from edge config to compare
      const edgeConfigData = await getEdgeValue('teamsToken');

      return res.status(200).json({
        success: true,
        updatedExpiresAt: updatedData.expiresAt,
        edgeConfigData,
        cachedData: updatedData,
      });
    } else {
      return res.status(405).json({ success: false, error: 'Method not allowed' });
    }
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}
