// lib/notifications/teamsMessenger.ts
import axios from "axios";
import { getTokenData, refreshAccessToken } from "../tokenManager";
import { MessageOptions } from "./types";

export class TeamsMessenger {
  private refreshingTokenPromise: Promise<string> | null = null;

  constructor() {
    this.validateEnv();
  }

  private validateEnv() {
    const requiredVars = [
      "CLIENT_ID",
      "CLIENT_SECRET",
      "TENANT_ID",
      "REDIRECT_URI",
      "EDGE_CONFIG_ID",
    ];

    for (const varName of requiredVars) {
      if (!process.env[varName]) {
        throw new Error(`Missing required environment variable: ${varName}`);
      }
    }
  }

  private async getAccessToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const tokenData = await getTokenData();

    if (tokenData && tokenData.expiresAt > now) {
      console.log("✅ Using cached access token (not expired)");
      return tokenData.accessToken;
    }

    if (this.refreshingTokenPromise) {
      return this.refreshingTokenPromise;
    }

    if (!tokenData?.refreshToken) {
      throw new Error("No refresh token available to refresh access token");
    }

    this.refreshingTokenPromise = (async () => {
      try {
        console.log("🔁 Refreshing access token...");
        const newToken = await refreshAccessToken(tokenData.refreshToken);
        return newToken.accessToken;
      } finally {
        this.refreshingTokenPromise = null;
      }
    })();

    return this.refreshingTokenPromise;
  }

  public async send({ teams, message }: MessageOptions): Promise<void> {
    const teamsId = teams.teamsId;
    const channelId = teams.channelId;

    let accessToken = await this.getAccessToken();

    try {
      await axios.post(
        `https://graph.microsoft.com/v1.0/teams/${teamsId}/channels/${channelId}/messages`,
        { body: { contentType: "html", content: message } },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        }
      );
      console.log("✅ Message sent to Teams");
    } catch (error: any) {
      const status = error?.response?.status;

      if (status === 401) {
        console.warn("⚠️ 401 Unauthorized. Attempting token refresh and retry...");

        try {
          const newToken = await refreshAccessToken((await getTokenData())?.refreshToken || "");
          accessToken = newToken.accessToken;

          // Retry message after token refresh
          await axios.post(
            `https://graph.microsoft.com/v1.0/teams/${teamsId}/channels/${channelId}/messages`,
            { body: { contentType: "html", content: message } },
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
              },
            }
          );
          console.log("✅ Message sent to Teams after retry");
        } catch (retryErr: any) {
          console.error("❌ Retry failed after token refresh:", retryErr);
          throw retryErr;
        }
      } else {
        console.error("❌ Error sending Teams message:", error);
        throw error;
      }
    }
  }
}
