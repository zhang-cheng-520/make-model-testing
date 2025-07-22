// endpoint to test sending message function

import type { NextApiRequest, NextApiResponse } from "next";
import { sendTeamsMessage } from "../../lib/messaging";

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {
    console.log("🔍 API route hit: /api/test-send");

    // Mock values to simulate a failed OpenAI call
    const make = "Nissan";
    const model = "Skyline";
    const capacity = "2500cc";
    const reason = "OpenAI model failed to respond within timeout window.";

    try {
        await sendTeamsMessage(
            `OpenAI processing failed. Make: ${make}. Model: ${model}. Capacity: ${capacity}. reason: ${reason}`
        );

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
