// /lib/notification/teamsMessenger.ts
import axios from "axios";
import { getTokenData, saveTokenData } from "../tokenManager";
import { MessageOptions } from "./types";

export class TeamsMessenger {
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
                throw new Error(
                    `Missing required environment variable: ${varName}`
                );
            }
        }
    }

    private async getAccessToken(): Promise<string> {
        const tokenData = await getTokenData();
        if (tokenData?.expiresAt > Math.floor(Date.now() / 1000)) {
            return tokenData.accessToken;
        }
        return this.refreshAccessToken(tokenData?.refreshToken);
    }

    private async refreshAccessToken(
        oldRefreshToken?: string
    ): Promise<string> {
        if (!oldRefreshToken) throw new Error("No refresh token available");

        const response = await axios.post(
            `https://login.microsoftonline.com/${process.env.TENANT_ID}/oauth2/v2.0/token`,
            new URLSearchParams({
                client_id: process.env.CLIENT_ID!,
                client_secret: process.env.CLIENT_SECRET!,
                grant_type: "refresh_token",
                refresh_token: oldRefreshToken,
                redirect_uri: process.env.REDIRECT_URI!,
                scope: "ChannelMessage.Send Chat.ReadWrite offline_access",
            })
        );

        const newTokenData = {
            accessToken: response.data.access_token,
            refreshToken: response.data.refresh_token,
            expiresAt:
                Math.floor(Date.now() / 1000) + response.data.expires_in - 30,
        };

        await saveTokenData(newTokenData);
        return newTokenData.accessToken;
    }

    public async send({ teams, message }: MessageOptions): Promise<void> {
        const teamsId = teams.teamsId 
        const channelId = teams.channelId

        await axios.post(
            `https://graph.microsoft.com/v1.0/teams/${teamsId}/channels/${channelId}/messages`,
            { body: { contentType: "html", content: message } },
            {
                headers: {
                    Authorization: `Bearer ${await this.getAccessToken()}`,
                    "Content-Type": "application/json",
                },
            }
        );
    }
}
