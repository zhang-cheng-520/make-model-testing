// pages/api/ca-request-reassignment.ts
//
// Receives a reassignment request from the UiPath Coded App and moves the
// task to the current "Case Assigners" group's member directly in
// Orchestrator — Orchestrator/Action Center stays the sole source of truth
// for task ownership. Nothing is written to Supabase for this feature (no
// case-assignment table, no reassignment_history table).
//
// Contract:
//   POST /api/ca-request-reassignment
//   body: { taskId: number, caseId: string, directoryId?: string, taskTitle?: string, reason: string }
//     (directoryId/taskTitle are accepted for forward-compatibility with the
//     Coded App's payload but not otherwise used — see the caseId/directoryId
//     note below)
//   -> 200 {
//        success: true, caseId, taskId,
//        requestedBy: { id, email?, name? },
//        newAssignee: { email, name },
//        reassignmentSucceeded: true,
//        commentAdded: boolean, commentError?: string
//      }
//
// requestedBy is never sent by the caller — it's derived from the task's
// real current assignee in UiPath (TaskCore.AssignedToUserId, resolved to an
// email/name via getOrchestratorUserById) before reassignment happens. A
// task with no current assignee is rejected (409) rather than inventing a
// requester; the frontend cannot supply requestedBy/currentAssignee either.
//
// Security model (deliberately NOT a browser-held shared secret — see the
// CA_REASSIGN_SECRET note below): the real protection is that this route
// verifies the supplied taskId against live UiPath data before writing
// anything, rather than trusting whatever the caller (a browser-side Coded
// App, inspectable in DevTools) claims:
//   - taskId must resolve to a real, non-completed, non-deleted task
//   - the task must belong to CA_FOLDER_ID (the Case Assignment folder every
//     other ca-* route in this repo already operates in) — this is what
//     stops the endpoint being used to reassign arbitrary unrelated Action
//     Center tasks elsewhere in the tenant
// None of this requires the caller to hold a secret. targetAssignee/userId/
// groupName are never accepted — see resolveCaseAssigner() below.
//
// caseId/directoryId are recorded (in the response and the task comment) but
// NOT cross-checked against the UiPath task — confirmed by direct testing
// that UiPath's Task entity has no field for either (`$select=Data` 400s
// with "Could not find a property named 'Data' on type ... TaskDto", and the
// task's Title is arbitrary business text like "Motor - Renewal" with no
// guaranteed relationship to a caseId). Requiring a match against a field
// that doesn't exist would reject every legitimate request, not just
// malicious ones, so taskId + folder ownership (both real UiPath fields) are
// the actual protection here, not caseId corroboration.
//
// Ordering: 1) validate the payload shape, 2) validate the task itself
// against live UiPath data (exists, active, correct folder), 3) retrieve its
// real current assignee (reject if unassigned), 4) resolve the Case
// Assigner, 5) reassign the task in Orchestrator, 6) add the reason
// (+ requestedBy) as a task comment, 7) respond. If any of 1-5 fails,
// nothing is written. If step 6 fails after step 5 succeeds, the response
// says so explicitly (reassignmentSucceeded: true, commentAdded: false)
// rather than rolling back the reassignment (Orchestrator has no documented
// "undo" for this, and guessing one would risk exactly the kind of
// speculative write this endpoint is meant to avoid).

import type { NextApiRequest, NextApiResponse } from "next";
import {
  addTaskComment,
  findGroupIdByName,
  getOrchestratorUserById,
  getResolvedGroupMembers,
  getTaskCoreById,
  reassignTask,
} from "../../lib/uipath";

const CA_ORG = process.env.CA_ORG || "";
const CA_TENANT = process.env.CA_TENANT || "";
const CA_ORCHESTRATOR_PAT = process.env.CA_ORCHESTRATOR_PAT || "";
const CA_FOLDER_ID = process.env.CA_FOLDER_ID || "";
// Optional extra gate for a non-browser/internal caller only — NOT the
// endpoint's real protection (see file header). If unset, simply skipped;
// this route must not depend on the Coded App possessing a secret, since
// anything sent by browser-side React is inspectable in DevTools/Network.
const CA_REASSIGN_SECRET = process.env.CA_REASSIGN_SECRET || "";

const CASE_ASSIGNERS_GROUP = "Case Assigners";
const MAX_REASON_LENGTH = 2000;

function parseTaskId(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Same CORS pattern as the other ca-* endpoints called from the UiPath
// Action Center iframe (pages/api/ca-orchestrator-attachment.ts,
// pages/api/ca-fileai-preview.ts) — the iframe's POST is preceded by a
// browser CORS preflight (OPTIONS), which must succeed before the browser
// will even attempt the actual POST.
function setCors(res: NextApiResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  if (CA_REASSIGN_SECRET && req.headers.authorization !== `Bearer ${CA_REASSIGN_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (!CA_ORCHESTRATOR_PAT || !CA_ORG || !CA_TENANT || !CA_FOLDER_ID) {
    return res.status(500).json({
      error: "CA_ORCHESTRATOR_PAT / CA_ORG / CA_TENANT / CA_FOLDER_ID not configured on the server",
    });
  }

  const body = (req.body || {}) as Record<string, unknown>;

  if (
    "targetAssignee" in body ||
    "userId" in body ||
    "groupName" in body ||
    "targetGroup" in body ||
    "assigneeEmail" in body ||
    "requestedBy" in body ||
    "currentAssignee" in body
  ) {
    return res.status(400).json({
      error:
        "targetAssignee/userId/groupName/targetGroup/assigneeEmail/requestedBy/currentAssignee are not accepted — " +
        "the Case Assigner is resolved server-side, and requestedBy is derived from the task's real current assignee in UiPath",
    });
  }

  // --- 1) Payload shape validation ---
  const taskId = parseTaskId(body.taskId);
  if (taskId === null) return res.status(400).json({ error: "taskId must be a positive integer" });

  const caseId = typeof body.caseId === "string" ? body.caseId.trim() : "";
  if (!caseId) return res.status(400).json({ error: "caseId is required" });

  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason) return res.status(400).json({ error: "reason is required" });
  if (reason.length > MAX_REASON_LENGTH) {
    return res.status(400).json({ error: `reason must be ${MAX_REASON_LENGTH} characters or fewer` });
  }

  try {
    // --- 2) Validate the task itself against live UiPath data, before any write ---
    const task = await getTaskCoreById(taskId);
    if (!task) {
      return res.status(404).json({ error: `Task ${taskId} not found in UiPath` });
    }
    if (task.IsDeleted) {
      return res.status(409).json({ error: `Task ${taskId} has been deleted and cannot be reassigned` });
    }
    if (task.IsCompleted) {
      return res.status(409).json({ error: `Task ${taskId} is already completed and cannot be reassigned` });
    }

    // Folder check — this is what stops the endpoint reassigning arbitrary
    // unrelated Action Center tasks elsewhere in the tenant: only tasks
    // living in the known Case Assignment folder are in scope at all.
    if (String(task.OrganizationUnitId) !== String(CA_FOLDER_ID)) {
      return res.status(403).json({
        error: `Task ${taskId} does not belong to the Case Assignment folder (expected folder ${CA_FOLDER_ID}, task is in ${task.OrganizationUnitId})`,
      });
    }

    // --- 3) Retrieve the task's real current assignee from UiPath — this,
    // not anything the frontend sends, is treated as the requester identity.
    if (task.AssignedToUserId === null) {
      return res.status(409).json({ error: `Task ${taskId} is unassigned — a current assignee is required to identify the requester` });
    }
    const currentAssigneeUser = await getOrchestratorUserById(task.AssignedToUserId);
    const requestedBy = currentAssigneeUser
      ? { id: String(currentAssigneeUser.id), email: currentAssigneeUser.email || undefined, name: currentAssigneeUser.name }
      : { id: String(task.AssignedToUserId) };
    const requestedByLabel = currentAssigneeUser?.email || currentAssigneeUser?.name || `user #${task.AssignedToUserId}`;

    // --- 4) Resolve the current Case Assigner server-side ---
    const group = await findGroupIdByName(CASE_ASSIGNERS_GROUP);
    if (!group) {
      return res.status(500).json({ error: `UiPath group "${CASE_ASSIGNERS_GROUP}" not found` });
    }
    const members = await getResolvedGroupMembers(group.id);
    if (members.length === 0) {
      return res.status(409).json({ error: `"${CASE_ASSIGNERS_GROUP}" has no members to reassign to` });
    }
    if (members.length > 1) {
      return res.status(409).json({
        error:
          `"${CASE_ASSIGNERS_GROUP}" currently has ${members.length} members — automatic reassignment only ` +
          `supports exactly one. Define an explicit selection rule (e.g. reuse the workload-based picker in ` +
          `ca-assign-task.ts) before enabling reassignment with multiple Case Assigners.`,
      });
    }
    const target = members[0];
    if (!target.email) {
      return res.status(500).json({ error: `Case Assigner "${target.name || target.identifier}" has no resolvable email` });
    }

    // --- 5) Reassign the task in Orchestrator — the source of truth ---
    try {
      await reassignTask(taskId, target.email);
    } catch (err: any) {
      console.error("ca-request-reassignment: UiPath reassignment failed:", err?.message || err);
      return res.status(502).json({
        error: `UiPath reassignment failed: ${String(err?.message || err)}`,
        reassignmentSucceeded: false,
      });
    }

    // --- 6) Record the reason on the task itself, in UiPath, not Supabase ---
    const commentText = [
      `Reassignment requested.`,
      `Requested by: ${requestedByLabel}`,
      `Reason: ${reason}`,
      `Case: ${caseId}`,
    ].join("\n");
    let commentAdded = true;
    let commentError: string | undefined;
    try {
      await addTaskComment(taskId, commentText, CA_FOLDER_ID);
    } catch (err: any) {
      commentAdded = false;
      commentError = String(err?.message || err);
      console.error("ca-request-reassignment: comment failed after successful reassignment:", commentError);
    }

    // --- 7) Respond ---
    const responseBody = {
      success: true,
      caseId,
      taskId,
      requestedBy,
      newAssignee: { email: target.email, name: target.name || target.identifier },
      reassignmentSucceeded: true,
      commentAdded,
      ...(commentError ? { commentError } : {}),
    };
    console.log("ca-request-reassignment:", JSON.stringify(responseBody));
    return res.status(200).json(responseBody);
  } catch (err: any) {
    console.error("ca-request-reassignment error:", err?.message || err);
    return res.status(500).json({ error: String(err?.message || err), reassignmentSucceeded: false });
  }
}
