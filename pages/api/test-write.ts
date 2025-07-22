// pages/api/test-write.ts
import { saveTokenData, getTokenData } from '../../lib/tokenManager';

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
      const tokenData = await getTokenData();
      return res.status(200).json({ success: true, tokenData });
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
