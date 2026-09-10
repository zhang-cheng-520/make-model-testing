// pages/api/ca-orchestrator-attachment.ts
//
// Writes a file into Orchestrator as a permanent Attachment, server-side,
// using CA_ORCHESTRATOR_PAT instead of the browser's (currently broken)
// Action Center silent-SSO delegation. Same two-step flow proven manually:
//   1. POST /odata/Attachments -> attachment record + short-lived blob SAS URL
//   2. PUT the file bytes to that URL
//
// Contract:
//   POST /api/ca-orchestrator-attachment
//   body: { fileName: string, contentType: string, fileBase64: string, folderId?: number }
//   -> 200 { id: string, name: string }

import type { NextApiRequest, NextApiResponse } from "next";

export const config = {
  api: {
    bodyParser: { sizeLimit: "12mb" }, // proof files are capped at 10MB client-side; leave headroom
  },
};

const CA_ORG = process.env.CA_ORG || "";
const CA_TENANT = process.env.CA_TENANT || "";
const CA_FOLDER_ID = process.env.CA_FOLDER_ID || "";
const CA_ORCHESTRATOR_PAT = process.env.CA_ORCHESTRATOR_PAT || "";

function orchestratorBase() {
  return `https://cloud.uipath.com/${CA_ORG}/${CA_TENANT}/orchestrator_`;
}

function setCors(res: NextApiResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

type BlobFileAccess = {
  Uri: string;
  Verb: string;
  RequiresAuth: boolean;
  Headers?: { Keys: string[]; Values: string[] };
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  if (!CA_ORCHESTRATOR_PAT || !CA_ORG || !CA_TENANT) {
    return res.status(500).json({ error: "CA_ORCHESTRATOR_PAT / CA_ORG / CA_TENANT not configured on the server" });
  }

  const { fileName, contentType, fileBase64, folderId } = (req.body || {}) as {
    fileName?: string;
    contentType?: string;
    fileBase64?: string;
    folderId?: number | string;
  };
  if (!fileName || !fileBase64) {
    return res.status(400).json({ error: "fileName and fileBase64 are required" });
  }

  const targetFolderId = String(folderId ?? CA_FOLDER_ID);
  if (!targetFolderId) {
    return res.status(400).json({ error: "No folderId provided and CA_FOLDER_ID is not configured" });
  }

  const label = `ca-orchestrator-attachment [fileName=${fileName} folderId=${targetFolderId}]`;

  try {
    // Step 1: create the attachment record, get back a short-lived write URI.
    const createRes = await fetch(`${orchestratorBase()}/odata/Attachments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CA_ORCHESTRATOR_PAT}`,
        "X-UIPATH-OrganizationUnitId": targetFolderId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ Name: fileName }),
    });
    if (!createRes.ok) {
      const body = await createRes.text().catch(() => "");
      console.error(`${label} Attachments create failed: ${createRes.status}`, body.slice(0, 1000));
      return res.status(502).json({ error: `Attachments create failed: ${createRes.status} ${body}`.slice(0, 1000) });
    }
    const created = (await createRes.json()) as { Id: string; Name: string; BlobFileAccess: BlobFileAccess };
    const blob = created.BlobFileAccess;
    console.log(`${label} attachment record created`, created.Id);

    // Step 2: upload the actual bytes to the blob SAS URL.
    const bytes = Buffer.from(fileBase64, "base64");
    const uploadHeaders: Record<string, string> = {};
    if (blob.Headers?.Keys) {
      blob.Headers.Keys.forEach((k, i) => (uploadHeaders[k] = blob.Headers!.Values[i]));
    }
    if (blob.RequiresAuth) {
      uploadHeaders["Authorization"] = `Bearer ${CA_ORCHESTRATOR_PAT}`;
    }
    if (contentType) uploadHeaders["Content-Type"] = contentType;

    const uploadRes = await fetch(blob.Uri, {
      method: blob.Verb || "PUT",
      headers: uploadHeaders,
      body: bytes,
    });
    if (!uploadRes.ok) {
      const body = await uploadRes.text().catch(() => "");
      console.error(`${label} Blob upload failed: ${uploadRes.status}`, body.slice(0, 1000));
      return res.status(502).json({ error: `Blob upload failed: ${uploadRes.status} ${body}`.slice(0, 1000) });
    }

    console.log(`${label} upload complete`, created.Id);
    return res.status(200).json({ id: created.Id, name: created.Name });
  } catch (err: any) {
    console.error(`${label} unhandled error`, err?.message || err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
