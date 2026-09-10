// pages/api/ca-orchestrator-attachment-url.ts
//
// Mints a fresh read URL for an existing Orchestrator attachment, server-side,
// using CA_ORCHESTRATOR_PAT instead of the browser's broken Action Center
// silent-SSO delegation. Mirrors Attachments.getById() from the SDK — same
// underlying call (GET /odata/Attachments(id)), just made with a credential
// that actually works from a server instead of a browser.
//
// Contract:
//   GET /api/ca-orchestrator-attachment-url?id=<attachmentId>
//   -> 200 { url: string, errorMessage: string }

import type { NextApiRequest, NextApiResponse } from "next";

const CA_ORG = process.env.CA_ORG || "";
const CA_TENANT = process.env.CA_TENANT || "";
const CA_ORCHESTRATOR_PAT = process.env.CA_ORCHESTRATOR_PAT || "";

function orchestratorBase() {
  return `https://cloud.uipath.com/${CA_ORG}/${CA_TENANT}/orchestrator_`;
}

function setCors(res: NextApiResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

type BlobFileAccess = { Uri: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ url: "", errorMessage: "Use GET" });

  if (!CA_ORCHESTRATOR_PAT || !CA_ORG || !CA_TENANT) {
    return res.status(500).json({ url: "", errorMessage: "CA_ORCHESTRATOR_PAT / CA_ORG / CA_TENANT not configured on the server" });
  }

  const { id } = req.query as { id?: string };
  if (!id) {
    return res.status(400).json({ url: "", errorMessage: "id is required" });
  }

  const label = `ca-orchestrator-attachment-url [id=${id}]`;

  try {
    const getRes = await fetch(`${orchestratorBase()}/odata/Attachments(${id})`, {
      headers: { Authorization: `Bearer ${CA_ORCHESTRATOR_PAT}` },
    });
    if (!getRes.ok) {
      const body = await getRes.text().catch(() => "");
      console.error(`${label} Attachments getById failed: ${getRes.status}`, body.slice(0, 1000));
      return res.status(502).json({ url: "", errorMessage: `Attachments getById failed: ${getRes.status} ${body}`.slice(0, 1000) });
    }
    const data = (await getRes.json()) as { BlobFileAccess?: BlobFileAccess };
    const url = data.BlobFileAccess?.Uri;
    if (!url) {
      console.error(`${label} no BlobFileAccess.Uri in response`, data);
      return res.status(502).json({ url: "", errorMessage: "Attachments getById returned no BlobFileAccess.Uri" });
    }
    console.log(`${label} resolved ok`);
    return res.status(200).json({ url, errorMessage: "" });
  } catch (err: any) {
    console.error(`${label} unhandled error`, err?.message || err);
    return res.status(500).json({ url: "", errorMessage: String(err?.message || err) });
  }
}
