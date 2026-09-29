// pages/api/ca-assign-task.ts
//
// Resolves a UiPath Identity Group *name* (e.g. "ECICS - RPA (BS)") to its
// members, tallies each member's current open Action Center workload in
// Orchestrator, and returns the member with the least load (round-robin by
// workload, not strict rotation). Read-only — does not assign the task yet.
//
// In-office aware (from the HR Dashboard's Supabase user_metadata table):
//   1. Only members marked "In Office" are eligible (default true if no row).
//      This is a pure boolean check — it never looks at *why* someone is
//      marked out (public holiday, LOA, medical leave, manual override all
//      look identical here), so the same fallback chain below covers all of
//      them uniformly.
//   2. If nobody in the requested group is in office, fall back to that
//      group's paired group (PAIRED_GROUP_BY_NAME below) and apply the same
//      in-office + workload logic there.
//   3. If nobody in the paired group is in office either (or no pairing is
//      defined for the requested group), fall back to the "Case Assigners"
//      group, same logic again.
//   4. If nobody in "Case Assigners" is in office either, pick a random
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

// Second-tier fallback, tried before Case Assigners, when the primary
// requested group has no in-office member. Matched case-insensitively on the
// requested `groupName` (not the resolved Identity group id) since pairing
// is a static naming relationship, independent of PH/LOA/manual status.
const PAIRED_GROUP_BY_NAME: Record<string, string> = {
  "ecics - sg (bs)": "ECICS - MY (BS)",
  "ecics - my (bs)": "ECICS - SG (BS)",
  // Confirmed against live UiPath Identity groups (GET /api/dashboard/groups)
  // — the real names follow the same "ECICS - X (BS)" convention as SG/MY,
  // not the bare "IPP"/"Single Deduction" shorthand.
  "ecics - ipp (bs)": "ECICS - Single Deduction (BS)",
  "ecics - single deduction (bs)": "ECICS - IPP (BS)",
};

function pairedGroupName(groupName: string): string | null {
  return PAIRED_GROUP_BY_NAME[groupName.trim().toLowerCase()] || null;
}

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

// ---------------------------------------------------------------------------
// Concurrency safety: two BPMN jobs can call this endpoint for the same group
// at (near) the same instant. Without coordination, both read the same
// "everyone is idle" snapshot from Orchestrator and both pick the same person.
// Fixed with:
//   1. A per-group advisory lock (Postgres row, acquired via an atomic
//      INSERT ... ON CONFLICT ... WHERE) so concurrent requests for the same
//      group are serialized through the pick-and-reserve step.
//   2. A short-TTL "pending reservation" ledger, added on top of the live
//      Orchestrator counts, to cover the seconds it takes for a just-made
//      assignment to actually show up in Orchestrator's own task list.
// ---------------------------------------------------------------------------
const LOCK_TTL_SECONDS = 5;
const LOCK_MAX_WAIT_MS = 15000;
const LOCK_RETRY_DELAY_MS = 150;
const PENDING_RESERVATION_TTL_SECONDS = 40;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireGroupLock(groupId: string): Promise<boolean> {
  const deadline = Date.now() + LOCK_MAX_WAIT_MS;
  while (Date.now() < deadline) {
    const { data, error } = await (supabaseAdmin() as any).rpc("try_acquire_lock", {
      p_group_id: groupId,
      p_ttl_seconds: LOCK_TTL_SECONDS,
    });
    if (error) throw new Error(`try_acquire_lock failed: ${error.message}`);
    if (data === true) return true;
    // Jitter avoids a thundering-herd effect where every waiting request
    // retries in lockstep and the same requests keep losing the race.
    await sleep(LOCK_RETRY_DELAY_MS + Math.floor(Math.random() * LOCK_RETRY_DELAY_MS));
  }
  return false;
}

async function releaseGroupLock(groupId: string): Promise<void> {
  const { error } = await (supabaseAdmin() as any).rpc("release_lock", { p_group_id: groupId });
  if (error) console.error(`release_lock failed for ${groupId}:`, error.message);
}

async function getPendingCounts(groupId: string): Promise<Map<number, number>> {
  const cutoff = new Date(Date.now() - PENDING_RESERVATION_TTL_SECONDS * 1000).toISOString();
  // Best-effort cleanup of expired reservations so the table doesn't grow unbounded.
  await supabaseAdmin().from("pending_assignments").delete().lt("reserved_at", cutoff);

  const { data, error } = await supabaseAdmin()
    .from("pending_assignments")
    .select("user_id")
    .eq("group_id", groupId)
    .gte("reserved_at", cutoff);
  if (error) throw new Error(`pending_assignments lookup failed: ${error.message}`);

  const counts = new Map<number, number>();
  for (const row of (data || []) as { user_id: number }[]) {
    counts.set(row.user_id, (counts.get(row.user_id) || 0) + 1);
  }
  return counts;
}

async function recordPendingAssignment(groupId: string, userId: number, email: string): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("pending_assignments")
    .insert({ group_id: groupId, user_id: userId, email } as any);
  if (error) console.error(`recordPendingAssignment failed for group ${groupId}, user ${userId}:`, error.message);
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

function pickLeastLoaded(
  candidates: Candidate[],
  tasks: TaskItem[],
  pendingCounts: Map<number, number>,
  mode: "strict-wip" | "balanced"
) {
  const byUser: Record<number, TaskItem[]> = {};
  for (const t of tasks) {
    if (t.AssignedToUserId == null) continue;
    (byUser[t.AssignedToUserId] ||= []).push(t);
  }
  const scored = candidates.map((c) => {
    const mine = byUser[c.userId] || [];
    const inProgress = mine.filter((t) => t.Status === "InProgress").length;
    // Pending reservations cover assignments made moments ago that haven't
    // shown up in Orchestrator's task list yet (concurrency + propagation lag).
    const totalAssignedOpen = mine.length + (pendingCounts.get(c.userId) || 0);
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
    let fallback: "none" | "paired-group" | "case-assigners" | "case-assigners-random" = "none";

    if (candidatesToUse.length === 0) {
      // Nobody in the requested group is in office -> try its paired group
      // (e.g. SG <-> MY, IPP <-> Single Deduction) before Case Assigners.
      const pairedName = pairedGroupName(groupName);
      if (pairedName) {
        const pairedGroup = await findGroupIdByName(pairedName);
        if (pairedGroup) {
          const pairedPool = await buildCandidatePool(pairedGroup.id);
          if (pairedPool.inOfficeCandidates.length > 0) {
            candidatesToUse = pairedPool.inOfficeCandidates;
            sourceGroupName = pairedName;
            sourceGroupId = pairedGroup.id;
            fallback = "paired-group";
          }
        }
      }
    }

    if (candidatesToUse.length === 0) {
      // Nobody in the requested group (or its paired group) is in office
      // (or none matched an Orchestrator user) -> fall back to "Case Assigners".
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

    // 3) current open (not completed, not deleted) tasks in the target folder.
    // Fetched *before* the lock — this is a folder-wide read that doesn't
    // depend on other concurrent requests' picks, so it doesn't need to sit
    // inside the serialized critical section (it's also the slowest call here).
    const tasks = await getOpenTasksInFolder(String(folderId));

    // 4) serialize concurrent requests for the same source group so two jobs
    // firing at once can't both read "everyone idle" and pick the same person.
    // Kept as small as possible (two fast Supabase round-trips) so a burst of
    // concurrent calls clears well within the wait budget.
    const gotLock = await acquireGroupLock(sourceGroupId);
    if (!gotLock) {
      return res.status(503).json({
        error: `Timed out waiting for the assignment lock on group "${sourceGroupName}" — another request is being processed. Retry.`,
        groupId: group.id,
        sourceGroupId,
      });
    }

    try {
      // 5) recent reservations not yet reflected in Orchestrator's task list
      const pendingCounts = await getPendingCounts(sourceGroupId);

      // 6) pick least-loaded among the eligible (in-office) candidates
      const { selected, tallies } = pickLeastLoaded(candidatesToUse, tasks, pendingCounts, mode);

      if (selected) {
        await recordPendingAssignment(sourceGroupId, selected.userId, selected.email);
      }

      const responseBody = {
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
      };

      // Logged in full so a specific Maestro run's response (who got picked,
      // and every candidate's task count at that moment) can be inspected
      // after the fact from the Vercel log stream, not just replayed live.
      console.log("ca-assign-task response:", JSON.stringify(responseBody));

      return res.status(200).json(responseBody);
    } finally {
      await releaseGroupLock(sourceGroupId);
    }
  } catch (err: any) {
    console.error("ca-assign-task error:", err?.message || err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
