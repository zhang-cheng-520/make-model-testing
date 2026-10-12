// pages/api/ca-assign-case-assigner.ts
//
// Assignee for the Processor "RequestReassign" outcome. Same group lookup, in-office
// filter, workload tally, lock and pending reservation as /api/ca-assign-task (the
// helpers are imported from it), but a different fallback rule:
//   1. In-office members of the Case Assigner group -> least-loaded (balanced by default).
//      The RPA account is never a candidate, even while it is a member of the group.
//   2. Nobody in office, or no assignable member -> the RPA account (a constant, so it does
//      not depend on the RPA account's group membership).
//   3. UiPath / Supabase failure -> 5xx error, never the RPA account.
// No paired-group fallback, no random pick, no working-hours logic (Maestro owns timing).
//
// Contract:
//   GET/POST /api/ca-assign-case-assigner
//   params/body: { folderId: string (required, e.g. Testing 1033718 / Live 1048073),
//                  groupName?: string = "Case Assigners", mode?: "strict-wip" | "balanced" }
//   -> 200 {
//        groupName, groupId, sourceGroup, sourceGroupId, fallback, fallbackReason, folderId, mode,
//        assigneeEmail, tallies: [{ email, name, userId, inProgress, totalAssignedOpen }]
//      }
//      fallback: "none" | "rpa-account"; fallbackReason: null | "none-in-office" | "group-empty"

import type { NextApiRequest, NextApiResponse } from "next";
import {
  acquireGroupLock,
  buildCandidatePool,
  findGroupIdByName,
  getOpenTasksInFolder,
  getPendingCounts,
  pickLeastLoaded,
  recordPendingAssignment,
  releaseGroupLock,
} from "./ca-assign-task";

const CA_ORG = process.env.CA_ORG || "";
const CA_TENANT = process.env.CA_TENANT || "";
const CA_ORCHESTRATOR_PAT = process.env.CA_ORCHESTRATOR_PAT || "";
const CA_IDENTITY_ORG_ID = process.env.CA_IDENTITY_ORG_ID || "";

const CASE_ASSIGNER_GROUP_NAME = "Case Assigners";
const RPA_ACCOUNT_EMAIL = "rpauser@ecics.com.sg";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== "GET" && req.method !== "POST") {
      return res.status(405).json({ error: "Use GET or POST" });
    }
    if (!CA_ORCHESTRATOR_PAT || !CA_ORG || !CA_TENANT || !CA_IDENTITY_ORG_ID) {
      return res.status(500).json({
        error: "CA_ORCHESTRATOR_PAT / CA_ORG / CA_TENANT / CA_IDENTITY_ORG_ID not configured on the server",
      });
    }

    const source = req.method === "GET" ? req.query : req.body || {};
    const groupName = ((source.groupName as string) || CASE_ASSIGNER_GROUP_NAME).trim();
    const mode: "strict-wip" | "balanced" = source.mode === "strict-wip" ? "strict-wip" : "balanced";
    // Required: Testing and Live use different Orchestrator folders, so never fall back to CA_FOLDER_ID.
    const folderId = String(source.folderId || "").trim();
    if (!/^\d+$/.test(folderId)) {
      return res.status(400).json({ error: "Provide folderId (numeric Orchestrator folder id)" });
    }

    // A missing group is a configuration error, not an empty group.
    const group = await findGroupIdByName(groupName);
    if (!group) {
      return res.status(404).json({ error: `No group found matching name "${groupName}"` });
    }

    const pool = await buildCandidatePool(group.id);
    const isRpa = (c: { email: string }) => c.email.toLowerCase() === RPA_ACCOUNT_EMAIL;
    const allCandidates = pool.allCandidates.filter((c) => !isRpa(c));
    const inOfficeCandidates = pool.inOfficeCandidates.filter((c) => !isRpa(c));

    const base = { groupName, groupId: group.id, sourceGroup: groupName, sourceGroupId: group.id, folderId, mode };

    if (inOfficeCandidates.length === 0) {
      const responseBody = {
        ...base,
        fallback: "rpa-account" as const,
        fallbackReason: allCandidates.length === 0 ? ("group-empty" as const) : ("none-in-office" as const),
        assigneeEmail: RPA_ACCOUNT_EMAIL,
        tallies: allCandidates.map((c) => ({
          email: c.email,
          name: c.name,
          userId: c.userId,
          inProgress: null,
          totalAssignedOpen: null,
        })),
      };
      console.log("ca-assign-case-assigner response:", JSON.stringify(responseBody));
      return res.status(200).json(responseBody);
    }

    // Same order as ca-assign-task: folder-wide task read outside the lock, then lock -> pick -> reserve.
    const tasks = await getOpenTasksInFolder(String(folderId));

    const gotLock = await acquireGroupLock(group.id);
    if (!gotLock) {
      return res.status(503).json({
        error: `Timed out waiting for the assignment lock on group "${groupName}" — another request is being processed. Retry.`,
        groupId: group.id,
        sourceGroupId: group.id,
      });
    }

    try {
      const pendingCounts = await getPendingCounts(group.id);
      const { selected, tallies } = pickLeastLoaded(inOfficeCandidates, tasks, pendingCounts, mode);
      if (selected) {
        await recordPendingAssignment(group.id, selected.userId, selected.email);
      }

      const responseBody = {
        ...base,
        fallback: "none" as const,
        fallbackReason: null,
        assigneeEmail: selected?.email || null,
        tallies: tallies.map((t) => ({
          email: t.email,
          name: t.name,
          userId: t.userId,
          inProgress: t.inProgress,
          totalAssignedOpen: t.totalAssignedOpen,
        })),
      };
      console.log("ca-assign-case-assigner response:", JSON.stringify(responseBody));
      return res.status(200).json(responseBody);
    } finally {
      await releaseGroupLock(group.id);
    }
  } catch (err: any) {
    console.error("ca-assign-case-assigner error:", err?.message || err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
