// pages/api/auth/callback.ts
import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";
import { saveTokenData } from "../../../lib/tokenManager";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const code = req.query.code as string;
  if (!code) return res.status(400).send("No auth code");

  const response = await axios.post(
    `https://login.microsoftonline.com/${process.env.TENANT_ID}/oauth2/v2.0/token`,
    new URLSearchParams({
      client_id: process.env.CLIENT_ID!,
      client_secret: process.env.CLIENT_SECRET!,
      code,
      grant_type: "authorization_code",
      redirect_uri: process.env.REDIRECT_URI!,
      scope: "https://graph.microsoft.com/ChannelMessage.Send https://graph.microsoft.com/Chat.ReadWrite https://graph.microsoft.com/Team.ReadBasic.All openid profile offline_access",
    }),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );

  const { access_token, refresh_token, expires_in } = response.data;
  await saveTokenData({
    accessToken: access_token,
    refreshToken: refresh_token,
    expiresAt: Math.floor(Date.now() / 1000) + expires_in,
  });

  res.send("✅ Authorized! You can now use /api/sendTeams.");
}