// pages/api/ca-fileai-preview.ts
//
// Mints a fresh fileAI document link on demand, so the Case Assignment coded
// app never has to store (and outlive) a presigned URL that dies after 3600s.
// Mirrors the not-yet-built "fileai-preview" API Workflow's contract exactly,
// so this can be swapped out for that workflow later with no client changes.
//
// Contract:
//   GET /api/ca-fileai-preview?directoryId=<caseId>&fileId=<documentId>
//   -> 200 { signedUrl: string, errorMessage: string }
//
// The trap (see API-WORKFLOW-fileai-preview.md): never resolve by
// `?fileId=` directly — fileAI silently ignores that filter and can return an
// unrelated customer's document. Always filter by `directoryId` first, then
// match `fileId` in code.

import type { NextApiRequest, NextApiResponse } from "next";

const FILEAI_BASE = process.env.CA_FILEAI_BASE_URL || "https://api.orion.sg.file.ai/prod/v1";
const FILEAI_API_KEY = process.env.CA_FILEAI_API_KEY || "";

type FileAiFile = { fileId: string; fileStoragePath: string; [k: string]: unknown };

function setCors(res: NextApiResponse) {
  // Loosened for local testing. Before deploying for real, restrict this to
  // the actual Action Center origin (https://cloud.uipath.com).
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ signedUrl: "", errorMessage: "Use GET" });

  const { directoryId, fileId } = req.query as { directoryId?: string; fileId?: string };
  if (!directoryId || !fileId) {
    return res.status(400).json({ signedUrl: "", errorMessage: "directoryId and fileId are required" });
  }
  if (!FILEAI_API_KEY) {
    return res.status(500).json({ signedUrl: "", errorMessage: "CA_FILEAI_API_KEY is not configured on the server" });
  }

  try {
    // Step 1+2: list files for this case folder, match fileId in code — never
    // call /files?fileId=, it silently ignores the filter (see markdown).
    const listRes = await fetch(
      `${FILEAI_BASE}/files?directoryId=${encodeURIComponent(directoryId)}&limit=200`,
      { headers: { "x-api-key": FILEAI_API_KEY } },
    );
    if (!listRes.ok) {
      const body = await listRes.text().catch(() => "");
      return res.status(502).json({
        signedUrl: "",
        errorMessage: `fileAI /files failed: ${listRes.status} ${body}`.slice(0, 500),
      });
    }
    const listData = (await listRes.json()) as { files?: FileAiFile[] };
    const match = (listData.files || []).find((f) => f.fileId === fileId);
    if (!match) {
      return res.status(404).json({ signedUrl: "", errorMessage: `No file with id ${fileId} in directory ${directoryId}` });
    }

    // Step 3: mint the preview URL from the matched storage path.
    const previewRes = await fetch(`${FILEAI_BASE}/files/preview`, {
      method: "POST",
      headers: { "x-api-key": FILEAI_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ s3Path: match.fileStoragePath }),
    });
    if (!previewRes.ok) {
      const body = await previewRes.text().catch(() => "");
      return res.status(502).json({
        signedUrl: "",
        errorMessage: `fileAI /files/preview failed: ${previewRes.status} ${body}`.slice(0, 500),
      });
    }
    const previewData = (await previewRes.json()) as { signedUrl?: string };
    if (!previewData.signedUrl) {
      return res.status(502).json({ signedUrl: "", errorMessage: "fileAI /files/preview returned no signedUrl" });
    }

    return res.status(200).json({ signedUrl: previewData.signedUrl, errorMessage: "" });
  } catch (err: any) {
    return res.status(500).json({ signedUrl: "", errorMessage: String(err?.message || err) });
  }
}
