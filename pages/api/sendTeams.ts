import type { NextApiRequest, NextApiResponse } from "next";
import { NotificationService } from "../../lib/notifications";

type ResponseData = {
  success: boolean;
  message: string;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ResponseData>
) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      message: "Method not allowed",
    });
  }

  const { message, teamsId, channelId } = req.body;

  if (!message) {
    return res.status(400).json({
      success: false,
      message: "Message is required",
    });
  }

  try {
    await NotificationService.send({
      message,
      teams:
        teamsId && channelId
          ? { teamsId, channelId }
          : {},
    });

    return res.status(200).json({
      success: true,
      message: "Teams message sent successfully",
    });
  } catch (err: any) {
    console.error(err);

    return res.status(500).json({
      success: false,
      message: err.message || "Failed to send Teams message",
    });
  }
}