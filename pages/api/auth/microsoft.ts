// pages/api/auth/microsoft.ts
import type { NextApiRequest, NextApiResponse } from "next";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const tenantId = process.env.TENANT_ID;
  const clientId = process.env.CLIENT_ID;
  const redirectUri = process.env.REDIRECT_URI; // e.g., http://localhost:3000/api/auth/callback

  const scope = encodeURIComponent(
    "https://graph.microsoft.com/ChannelMessage.Send https://graph.microsoft.com/Chat.ReadWrite https://graph.microsoft.com/Team.ReadBasic.All openid profile offline_access"
  );

  const authUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&response_mode=query`;

  res.redirect(authUrl);
}