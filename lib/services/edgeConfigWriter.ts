// lib/edgeConfigWriter.ts
interface EdgeConfigWriteOperation {
    operation: "upsert" | "delete";
    key: string;
    value?: any;
}

export async function updateEdgeConfig(
    operations: EdgeConfigWriteOperation[]
): Promise<void> {
    if (!process.env.EDGE_CONFIG_ID || !process.env.VERCEL_ACCESS_TOKEN) {
        throw new Error(
            "Missing required env vars: EDGE_CONFIG_ID and VERCEL_ACCESS_TOKEN"
        );
    }

    const API_URL = `https://api.vercel.com/v1/edge-config/${process.env.EDGE_CONFIG_ID}/items?teamId=${process.env.VERCEL_TEAM_ID}`;

    const body = JSON.stringify({ items: operations });

    const response = await fetch(API_URL, {
        method: "PATCH",
        headers: {
            Authorization: `Bearer ${process.env.VERCEL_ACCESS_TOKEN}`,
            "Content-Type": "application/json",
        },
        body,
    });

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
            `Edge Config update failed (HTTP ${response.status}): ${errorBody}`
        );
    }
}
