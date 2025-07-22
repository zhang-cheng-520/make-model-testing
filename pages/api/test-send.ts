// endpoint to test sending message function

import type { NextApiRequest, NextApiResponse } from "next";
import { NotificationService } from "../../lib/notifications";

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {
    console.log("🔍 API route hit: /api/test-send");

    const make = "Nissan";
    const model = "Skyline";
    const capacity = "2500cc";
    const reason = "OpenAI model failed to respond within timeout window.";

    try {
        console.log('api')
        await NotificationService.send({
            message: `OpenAI response success. Status: 200. Make: ${make}. Model: ${model}. Capacity: ${
                capacity ?? "N/A"
            }`,
            teams: { teamsId:process.env.DEFAULT_TEAMS_ID ,channelId:process.env.DEFAULT_CHANNEL_ID},
        });

        console.log("✅ Teams error message sent successfully");
        res.status(200).json({ message: "Teams error message sent" });
    } catch (err: any) {
        console.error("❌ Error sending Teams message:", err);
        res.status(500).json({
            error: "Failed to send Teams message",
            detail: err.message,
        });
    }
}
