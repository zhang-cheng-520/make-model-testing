import type { NextApiRequest, NextApiResponse } from "next";
import OpenAI from "openai";
import { NotificationService } from "../../lib/notifications";

type ResponseData = {
    message: string;
};

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse<ResponseData>
) {
    let make = req?.query?.make as string | undefined;
    let model = req?.query?.model as string | undefined;
    let capacity = req?.query?.capacity as string | undefined;

    let teamsId = req.query?.teamsId as string | undefined;
    let channelId = req.query?.channelId as string | undefined;

    if (!make || !model) {
        res.status(400).json({ message: "Make and model are required" });
        return;
    }

    try {
        const openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
        });

        const result = await openai.responses.create({
            model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
            prompt: {
                id:
                    process.env.MAKE_MODEL_PROMPT_ID ||
                    "pmpt_68620345e1f88196b11ff559653f8a8a027c30844d42555e",
                version: process.env.MAKE_MODEL_PROMPT_VERSION || "1",
                variables: {
                    format: "json",
                    input_make: make,
                    input_model: model,
                    input_capacity: capacity || undefined,
                },
            },
            input: [
                {
                    role: "user",
                    content: [
                        {
                            type: "input_text",
                            text: "Always respond in json format. Do not respond in any other format. If you do not know the answer, respond with an empty JSON object.",
                        },
                    ],
                },
                {
                    id: "fs_686258acfad0819a84d2be5fa2ee69310b7fbec102de2314",
                    type: "file_search_call",
                    status: "completed",
                    queries: [`${make} ${model} ${capacity ? capacity : ""}`],
                    results: null,
                },
            ],
            reasoning: {},
            tools: [
                {
                    type: "file_search",
                    vector_store_ids: ["vs_686202aa5cd88191b6fac89bfebeb237"],
                },
            ],
            max_output_tokens: 2048,
            store: true,
        });

        let output = result.output_text || "";
        let outputJson = JSON.parse(output);

        console.dir(
            {
                version: process.env.MAKE_MODEL_PROMPT_VERSION,
                input: {
                    make,
                    model,
                    capacity,
                },
                output: outputJson,
            },
            { depth: null }
        );
        res.status(200).json(outputJson);

        await NotificationService.send({
            message: `OpenAI response success. Status: 200. Make: ${make}. Model: ${model}. Capacity: ${
                capacity ?? "N/A"
            }`,
            teams: teamsId && channelId ? { teamsId, channelId } : undefined,
        });

        console.log("Teams message sent with OpenAI response");
    } catch (error) {
        console.dir({ error }, { depth: null });

        const reason = error?.reason || error?.message || "Unknown error";
        const statusCode = error?.statusCode || 500;

        res.status(statusCode).json({ message: reason });
        try {
            await NotificationService.send({
                message: `❌ OpenAI Failure | Status: ${statusCode} | Make: ${make || "N/A"
                } | Model: ${model || "N/A"} | Error: ${reason}`,
                teams: teamsId && channelId ? { teamsId, channelId } : undefined,
            });
        } catch (teamsErr: any) {
            console.error(
                "Failed to send Teams error log:",
                teamsErr.message || teamsErr
            );
        }
    }
}
