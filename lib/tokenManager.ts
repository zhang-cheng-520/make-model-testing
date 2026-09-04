// lib/tokenManager.ts
import fs from "fs";
import path from "path";

interface TokenData {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

const TOKEN_FILE = path.join(process.cwd(), ".token-cache.json");

// In-memory cache (resets on server restart)
let memoryCache: TokenData | null = null;

export async function getTokenData(): Promise<TokenData | null> {
  // 1. Check in-memory first
  if (memoryCache) {
    console.log("📦 Using in-memory token cache");
    return memoryCache;
  }

  // 2. Fallback to file-based cache (survives hot reloads in dev)
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      const raw = fs.readFileSync(TOKEN_FILE, "utf-8");
      const data: TokenData = JSON.parse(raw);
      memoryCache = data; // hydrate memory
      console.log("📁 Loaded token from file cache");
      return data;
    }
  } catch (err) {
    console.warn("⚠️ Failed to read token file:", err);
  }

  return null;
}

export async function saveTokenData(data: TokenData): Promise<void> {
  memoryCache = data; // always update memory

  // Also persist to file so dev server hot reloads don't lose it
  try {
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(data, null, 2), "utf-8");
    console.log("💾 Token saved to file cache");
  } catch (err) {
    console.warn("⚠️ Failed to write token file:", err);
  }
}

export async function clearTokenData(): Promise<void> {
  memoryCache = null;
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      fs.unlinkSync(TOKEN_FILE);
      console.log("🗑️ Token cache cleared");
    }
  } catch (err) {
    console.warn("⚠️ Failed to clear token file:", err);
  }
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenData> {
  const axios = (await import("axios")).default;

  console.log("Refreshing token...");
  console.log("Tenant ID:", process.env.TENANT_ID);
  console.log("Client ID:", process.env.CLIENT_ID);
  console.log("Redirect URI:", process.env.REDIRECT_URI);

  try {
    const response = await axios.post(
      `https://login.microsoftonline.com/${process.env.TENANT_ID}/oauth2/v2.0/token`,
      new URLSearchParams({
        client_id: process.env.CLIENT_ID!,
        client_secret: process.env.CLIENT_SECRET!,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
        scope: "https://graph.microsoft.com/ChannelMessage.Send https://graph.microsoft.com/Chat.ReadWrite https://graph.microsoft.com/Team.ReadBasic.All openid profile offline_access",
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    const { access_token, refresh_token, expires_in } = response.data;
    const expiresAt = Math.floor(Date.now() / 1000) + expires_in;

    const tokenData: TokenData = {
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresAt,
    };

    await saveTokenData(tokenData);
    return tokenData;
  } catch (error: any) {
    console.error("========== MICROSOFT OAUTH ERROR ==========");
    console.error("Status:", error.response?.status);
    console.error(error.response?.data);
    console.error("===========================================");
    throw error;
  }
}