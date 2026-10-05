// pages/api/dashboard/trpa-queue.ts
//
// Adds one Orchestrator queue item per policy number to the TRPA queue
// (Release+DebitNote flow). Protected by middleware.ts (all /api/dashboard/*
// routes require a valid dashboard session).
//
// Contract:
//   POST /api/dashboard/trpa-queue
//   body: { policyNumbers: string[], requestType: string }
//   -> 200 { results: [{ policyNumber, success, id?, key?, error? }] }

import type { NextApiRequest, NextApiResponse } from "next";

const CA_ORG = process.env.CA_ORG || "";
const CA_TENANT = process.env.CA_TENANT || "";
const CA_ORCHESTRATOR_PAT = process.env.CA_ORCHESTRATOR_PAT || "";
const TRPA_FOLDER_ID = process.env.TRPA_FOLDER_ID || "";

function orchestratorBase() {
  return `https://cloud.uipath.com/${CA_ORG}/${CA_TENANT}/orchestrator_`;
}

type QueueItemResult = {
  policyNumber: string;
  success: boolean;
  id?: number;
  key?: string;
  error?: string;
};

async function addOne(policyNumber: string, requestType: string): Promise<QueueItemResult> {
  const body = {
    itemData: {
      Name: "TRPA",
      Reference: policyNumber,
      SpecificContent: {
        ProcessType: "Release",
        RequestType: requestType,
        Payload: "Success",
        pol_number: policyNumber,
      },
    },
  };

  const res = await fetch(`${orchestratorBase()}/odata/Queues/UiPathODataSvc.AddQueueItem`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CA_ORCHESTRATOR_PAT}`,
      "X-UIPATH-OrganizationUnitId": TRPA_FOLDER_ID,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(`trpa-queue [pol=${policyNumber}] AddQueueItem failed: ${res.status}`, text.slice(0, 500));
    return { policyNumber, success: false, error: `${res.status} ${text}`.slice(0, 500) };
  }

  const data = (await res.json()) as { Id: number; Key: string };
  console.log(`trpa-queue [pol=${policyNumber}] queued ok`, data.Id);
  return { policyNumber, success: true, id: data.Id, key: data.Key };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  if (!CA_ORCHESTRATOR_PAT || !CA_ORG || !CA_TENANT || !TRPA_FOLDER_ID) {
    return res.status(500).json({
      error: "CA_ORCHESTRATOR_PAT / CA_ORG / CA_TENANT / TRPA_FOLDER_ID not configured on the server",
    });
  }

  const { policyNumbers, requestType } = (req.body || {}) as { policyNumbers?: string[]; requestType?: string };
  if (!Array.isArray(policyNumbers) || policyNumbers.length === 0) {
    return res.status(400).json({ error: "policyNumbers must be a non-empty array" });
  }
  const cleanNumbers = [...new Set(policyNumbers.map((p) => p.trim()).filter(Boolean))];
  if (cleanNumbers.length === 0) {
    return res.status(400).json({ error: "No non-empty policy numbers provided" });
  }
  const effectiveRequestType = (requestType || "").trim() || "Manual - Bulk Release";

  try {
    const results = await Promise.all(cleanNumbers.map((pol) => addOne(pol, effectiveRequestType)));
    return res.status(200).json({ results });
  } catch (err: any) {
    console.error("trpa-queue unhandled error:", err?.message || err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
