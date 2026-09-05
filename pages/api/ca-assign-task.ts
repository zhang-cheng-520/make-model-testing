// pages/api/ca-assign-task.ts
//
// Resolves a UiPath Identity Group *name* (e.g. "ECICS - RPA (BS)") to its
// members, tallies each member's current open Action Center workload in
// Orchestrator, and returns the member with the least load (round-robin by
// workload, not strict rotation). Read-only — does not assign the task yet.
//
// In-office aware (from the HR Dashboard's Supabase user_metadata table):
//   1. Only members marked "In Office" are eligible (default true if no row).
//   2. If nobody in the requested group is in office, fall back to the
//      "Case Assigners" group and apply the same in-office + workload logic.
//   3. If nobody in "Case Assigners" is in office either, pick a random
//      member from "Case Assigners" (workload ignored at that point).
//
// Contract:
//   GET/POST /api/ca-assign-task
//   params/body: { groupName: string, mode?: "strict-wip" | "balanced" }
//   -> 200 {
//        groupName, groupId, sourceGroup, fallback, assigneeEmail, mode,
//        tallies: [{ email, name, userId, inProgress, totalAssignedOpen }]
//      }
//
// Same UiPath account/tenant as the other ca-* routes in this project
// (IFSGrpTech / ECICS_Singapore) — reuses CA_ORG / CA_TENANT / CA_FOLDER_ID /
// CA_ORCHESTRATOR_PAT from .env, plus CA_IDENTITY_ORG_ID (the Identity
// service organizationId, confirmed against the Group endpoints).

import type { NextApiRequest, NextApiResponse } from "next";
import { supabaseAdmin } from "../../lib/supabaseAdmin";

const CA_ORG = process.env.CA_ORG || "";
const CA_TENANT = process.env.CA_TENANT || "";
const CA_FOLDER_ID = process.env.CA_FOLDER_ID || "";
const CA_ORCHESTRATOR_PAT = process.env.CA_ORCHESTRATOR_PAT || "";
const CA_IDENTITY_ORG_ID = process.env.CA_IDENTITY_ORG_ID || "";

const FALLBACK_GROUP_NAME = "Case Assigners";

function identityBase() {
  return `https://cloud.uipath.com/${CA_ORG}/identity_`;
}

function orchestratorBase() {
  return `https://cloud.uipath.com/${CA_ORG}/${CA_TENANT}/orchestrator_`;
}

async function uiGet<T>(url: string, extraHeaders?: Record<string, string>): Promise<T> {
  if (!CA_ORCHESTRATOR_PAT) throw new Error("CA_ORCHESTRATOR_PAT is missing");
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${CA_ORCHESTRATOR_PAT}`,
      "Content-Type": "application/json",
      ...extraHeaders,
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText} for ${url}\n${body}`.slice(0, 1000));
  }
  return res.json();
}

type IdentityGroup = { id: string; name: string; displayName?: string };

async function findGroupIdByName(groupName: string): Promise<IdentityGroup | null> {
  const url = `${identityBase()}/api/Group/${CA_IDENTITY_ORG_ID}`;
  const groups = await uiGet<IdentityGroup[]>(url);
  const needle = groupName.trim().toLowerCase();
  return (
    groups.find(
      (g) => g.name?.trim().toLowerCase() === needle || g.displayName?.trim().toLowerCase() === needle
    ) || null
  );
}

type IdentityMember = { identifier: string; email?: string; displayName?: string };

async function getGroupMembers(groupId: string): Promise<IdentityMember[]> {
  const url = `${identityBase()}/api/Group/${CA_IDENTITY_ORG_ID}/${groupId}`;
  const data = await uiGet<{ members?: any[] }>(url);
  const raw = data.members || [];
  return raw
    .filter((m) => m.objectType === "DirectoryUser")
    .map((m) => ({
      identifier: m.identifier,
      email: (m.email || m.name || "").toLowerCase() || undefined,
      displayName: m.displayName || m.name || m.email || undefined,
    }));
}

type OrchestratorUser = { Id: number; EmailAddress?: string; UserName?: string; Key: string; Type?: string };

async function getAllUsers(): Promise<OrchestratorUser[]> {
  const url = `${orchestratorBase()}/odata/Users?$top=1000&$select=Id,EmailAddress,UserName,Key,Type`;
  const data = await uiGet<{ value: OrchestratorUser[] }>(url);
  return data.value || [];
}

type TaskItem = {
  Id: number;
  AssignedToUserId: number | null;
  Status: string;
  IsCompleted: boolean;
  IsDeleted: boolean;
  CreationTime: string;
  OrganizationUnitId: number;
};

async function getOpenTasksInFolder(folderId: string): Promise<TaskItem[]> {
  const base = `${orchestratorBase()}/odata/Tasks/UiPath.Server.Configuration.OData.GetTasksAcrossFoldersForAdmin`;
  const select = "Id,Status,IsCompleted,IsDeleted,CreationTime,AssignedToUserId,OrganizationUnitId";
  const filter = [`OrganizationUnitId eq ${folderId}`, `IsCompleted eq false`, `IsDeleted eq false`].join(" and ");
  const url = `${base}?$top=1000&$count=true&$select=${encodeURIComponent(select)}&$filter=${encodeURIComponent(filter)}`;
  const data = await uiGet<{ value: TaskItem[] }>(url, { "X-UIPATH-OrganizationUnitId": folderId });
  return data.value || [];
}

// In-office status from the HR Dashboard's Supabase table. Missing row -> default true
// (same default the dashboard itself uses — PRD §5.3).
async function getInOfficeMap(identifiers: string[]): Promise<Map<string, boolean>> {
  const map = new Map<string, boolean>();
  if (identifiers.length === 0) return map;
  const { data, error } = await supabaseAdmin()
    .from("user_metadata")
    .select("uipath_id, in_office")
    .in("uipath_id", identifiers);
  if (error) throw new Error(`Supabase user_metadata lookup failed: ${error.message}`);
  for (const row of (data || []) as { uipath_id: string; in_office: boolean }[]) {
    map.set(row.uipath_id, row.in_office);
  }
  return map;
}

type Candidate = { identifier: string; email: string; name: string; userId: number };

async function buildCandidatePool(groupId: string): Promise<{ allCandidates: Candidate[]; inOfficeCandidates: Candidate[] }> {
  const [members, allUsers] = await Promise.all([getGroupMembers(groupId), getAllUsers()]);
  const userByKey = new Map(
    allUsers.filter((u) => u.Type === "DirectoryUser").map((u) => [u.Key.toLowerCase(), u])
  );
  const allCandidates = members
    .map((m) => {
      const u = userByKey.get(m.identifier.toLowerCase());
      return {
        identifier: m.identifier,
        email: (m.email || u?.EmailAddress || u?.UserName || "").toLowerCase(),
        name: m.displayName || u?.UserName || u?.EmailAddress || "",
        userId: u?.Id as number | undefined,
      };
    })
    .filter((c) => typeof c.userId === "number" && c.email) as Candidate[];

  const inOfficeMap = await getInOfficeMap(allCandidates.map((c) => c.identifier));
  const inOfficeCandidates = allCandidates.filter((c) => inOfficeMap.get(c.identifier) !== false);

  return { allCandidates, inOfficeCandidates };
}

function alphaName(a: string, b: string) {
  return a.localeCompare(b, "en", { sensitivity: "base" });
}

function pickLeastLoaded(candidates: Candidate[], tasks: TaskItem[], mode: "strict-wip" | "balanced") {
  const byUser: Record<number, TaskItem[]> = {};
  for (const t of tasks) {
    if (t.AssignedToUserId == null) continue;
    (byUser[t.AssignedToUserId] ||= []).push(t);
  }
  const scored = candidates.map((c) => {
    const mine = byUser[c.userId] || [];
    const inProgress = mine.filter((t) => t.Status === "InProgress").length;
    const totalAssignedOpen = mine.length;
    return { ...c, inProgress, totalAssignedOpen };
  });

  if (mode === "strict-wip") {
    scored.sort((a, b) => a.inProgress - b.inProgress || alphaName(a.name || a.email, b.name || b.email));
  } else {
    scored.sort(
      (a, b) =>
        a.inProgress - b.inProgress ||
        a.totalAssignedOpen - b.totalAssignedOpen ||
        alphaName(a.name || a.email, b.name || b.email)
    );
  }

  return { selected: scored[0] || null, tallies: scored };
}

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
    const groupName = (source.groupName as string) || "";
    const mode: "strict-wip" | "balanced" = source.mode === "strict-wip" ? "strict-wip" : "balanced";
    const folderId = (source.folderId as string) || CA_FOLDER_ID;

    if (!groupName) {
      return res.status(400).json({ error: "Provide groupName" });
    }
    if (!folderId) {
      return res.status(400).json({ error: "No folderId provided and CA_FOLDER_ID is not configured" });
    }

    // 1) group name -> group id
    const group = await findGroupIdByName(groupName);
    if (!group) {
      return res.status(404).json({ error: `No group found matching name "${groupName}"` });
    }

    // 2) group id -> candidate pool (members joined to Orchestrator users), split by in-office
    const pool = await buildCandidatePool(group.id);

    let candidatesToUse: Candidate[] = pool.inOfficeCandidates;
    let sourceGroupName = groupName;
    let sourceGroupId = group.id;
    let fallback: "none" | "case-assigners" | "case-assigners-random" = "none";

    if (candidatesToUse.length === 0) {
      // Nobody in the requested group is in office (or none matched an Orchestrator user)
      // -> fall back to the "Case Assigners" group.
      const fallbackGroup = await findGroupIdByName(FALLBACK_GROUP_NAME);
      if (!fallbackGroup) {
        return res.status(404).json({
          error: `No in-office members in "${groupName}", and fallback group "${FALLBACK_GROUP_NAME}" was not found`,
          groupId: group.id,
        });
      }
      const fallbackPool = await buildCandidatePool(fallbackGroup.id);
      sourceGroupName = FALLBACK_GROUP_NAME;
      sourceGroupId = fallbackGroup.id;

      if (fallbackPool.inOfficeCandidates.length > 0) {
        candidatesToUse = fallbackPool.inOfficeCandidates;
        fallback = "case-assigners";
      } else if (fallbackPool.allCandidates.length > 0) {
        // Nobody in Case Assigners is in office either -> ignore workload, pick randomly.
        const random = fallbackPool.allCandidates[Math.floor(Math.random() * fallbackPool.allCandidates.length)];
        return res.status(200).json({
          groupName,
          groupId: group.id,
          sourceGroup: sourceGroupName,
          sourceGroupId,
          fallback: "case-assigners-random",
          mode,
          assigneeEmail: random.email,
          tallies: fallbackPool.allCandidates.map((c) => ({
            email: c.email,
            name: c.name,
            userId: c.userId,
            inProgress: null,
            totalAssignedOpen: null,
          })),
        });
      } else {
        return res.status(404).json({
          error: `No members in "${groupName}" or fallback group "${FALLBACK_GROUP_NAME}" could be matched to an Orchestrator user`,
          groupId: group.id,
          fallbackGroupId: fallbackGroup.id,
        });
      }
    }

    // 3) current open (not completed, not deleted) tasks in the target folder
    const tasks = await getOpenTasksInFolder(String(folderId));

    // 4) pick least-loaded among the eligible (in-office) candidates
    const { selected, tallies } = pickLeastLoaded(candidatesToUse, tasks, mode);

    return res.status(200).json({
      groupName,
      groupId: group.id,
      sourceGroup: sourceGroupName,
      sourceGroupId,
      fallback,
      folderId,
      mode,
      assigneeEmail: selected?.email || null,
      tallies: tallies.map((t) => ({
        email: t.email,
        name: t.name,
        userId: t.userId,
        inProgress: t.inProgress,
        totalAssignedOpen: t.totalAssignedOpen,
      })),
    });
  } catch (err: any) {
    console.error("ca-assign-task error:", err?.message || err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
