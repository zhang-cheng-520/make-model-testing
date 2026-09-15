// lib/uipath.ts
// Shared server-side UiPath helpers for the IFSGrpTech/ECICS_Singapore account,
// same pattern already proven in pages/api/ca-assign-task.ts.

const CA_ORG = process.env.CA_ORG || "";
const CA_TENANT = process.env.CA_TENANT || "";
const CA_ORCHESTRATOR_PAT = process.env.CA_ORCHESTRATOR_PAT || "";
const CA_IDENTITY_ORG_ID = process.env.CA_IDENTITY_ORG_ID || "";

export function assertUipathConfigured() {
  if (!CA_ORCHESTRATOR_PAT || !CA_ORG || !CA_TENANT || !CA_IDENTITY_ORG_ID) {
    throw new Error("CA_ORCHESTRATOR_PAT / CA_ORG / CA_TENANT / CA_IDENTITY_ORG_ID not configured on the server");
  }
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

async function uiPost<T>(url: string, body: unknown, extraHeaders?: Record<string, string>): Promise<T> {
  if (!CA_ORCHESTRATOR_PAT) throw new Error("CA_ORCHESTRATOR_PAT is missing");
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CA_ORCHESTRATOR_PAT}`,
      "Content-Type": "application/json",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} for ${url}\n${text}`.slice(0, 1000));
  }
  if (!text) return undefined as unknown as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

export type IdentityGroup = { id: string; name: string; displayName?: string; type: number };

export async function getGroups(): Promise<IdentityGroup[]> {
  const url = `${identityBase()}/api/Group/${CA_IDENTITY_ORG_ID}`;
  return uiGet<IdentityGroup[]>(url);
}

export async function getCustomGroups(): Promise<IdentityGroup[]> {
  const groups = await getGroups();
  // type 0 = built-in (Everyone, Administrators, ...), type 1 = custom — confirmed against the Admin UI.
  return groups.filter((g) => g.type !== 0);
}

// Case-insensitive match on name or displayName — same resolution logic
// ca-assign-task.ts uses privately, made reusable here.
export async function findGroupIdByName(groupName: string): Promise<IdentityGroup | null> {
  const groups = await getGroups();
  const needle = groupName.trim().toLowerCase();
  return (
    groups.find(
      (g) => g.name?.trim().toLowerCase() === needle || g.displayName?.trim().toLowerCase() === needle
    ) || null
  );
}

export type IdentityMember = { identifier: string; email?: string; displayName?: string };

export async function getGroupMembers(groupId: string): Promise<IdentityMember[]> {
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

export type OrchestratorUser = { Id: number; EmailAddress?: string; UserName?: string; Key: string; Type?: string };

export async function getAllOrchestratorUsers(): Promise<OrchestratorUser[]> {
  const url = `${orchestratorBase()}/odata/Users?$top=1000&$select=Id,EmailAddress,UserName,Key,Type`;
  const data = await uiGet<{ value: OrchestratorUser[] }>(url);
  return data.value || [];
}

export type ResolvedMember = { identifier: string; email: string; name: string };

// Joins Identity group members to Orchestrator users, same logic as ca-assign-task.ts,
// but keyed by the stable Identity `identifier` (not the Orchestrator numeric Id) since
// the dashboard's metadata table joins on `identifier`, not on task-assignment user Id.
export async function getResolvedGroupMembers(groupId: string): Promise<ResolvedMember[]> {
  const [members, allUsers] = await Promise.all([getGroupMembers(groupId), getAllOrchestratorUsers()]);
  const userByKey = new Map(
    allUsers.filter((u) => u.Type === "DirectoryUser").map((u) => [u.Key.toLowerCase(), u])
  );
  return members.map((m) => {
    const u = userByKey.get(m.identifier.toLowerCase());
    return {
      identifier: m.identifier,
      email: (m.email || u?.EmailAddress || u?.UserName || "").toLowerCase(),
      name: m.displayName || u?.UserName || u?.EmailAddress || "",
    };
  });
}

// --- Task reassignment (pages/api/ca-request-reassignment.ts) ---
//
// Endpoint and payload shapes below are verified against the
// @uipath/uipath-typescript SDK's compiled source (v1.7.1,
// dist/tasks/index.mjs — TASK_ENDPOINTS.REASSIGN_TASKS / TASK_NOTE_ENDPOINTS.CREATE
// and their request-building code), NOT from public API docs — UiPath's public
// Orchestrator API guide documents AssignTasks/UnassignTasks but not
// ReassignTasks or TaskNotes at all. Not live-tested against this tenant.
//
// ReassignTasks is a distinct action from AssignTasks (which the public docs
// confirm errors with code 2400 "Task is already assigned" if the task
// already has an assignee) — ReassignTasks exists specifically to move an
// already-assigned task to a new user in one call, per the SDK's own method
// docs ("Reassigns tasks to new users" / "Reassign a single task to a user").

type TaskAssignmentErrorItem = {
  TaskId?: number;
  ErrorCode?: number;
  ErrorMessage?: string;
  errorCode?: number;
  errorMessage?: string;
};

export async function reassignTask(taskId: number, userNameOrEmail: string): Promise<void> {
  const url = `${orchestratorBase()}/odata/Tasks/UiPath.Server.Configuration.OData.ReassignTasks`;
  const response = await uiPost<TaskAssignmentErrorItem[]>(url, {
    TaskAssignments: [{ TaskId: taskId, UserNameOrEmail: userNameOrEmail }],
  });
  // Confirmed from the SDK's own handling: this OData bulk action returns an
  // empty array on success; a non-empty array carries one error item per
  // failed assignment (HTTP status alone does not indicate per-item failure).
  if (Array.isArray(response) && response.length > 0) {
    const first = response[0];
    const code = first.ErrorCode ?? first.errorCode;
    const message = first.ErrorMessage ?? first.errorMessage ?? "Unknown error";
    throw new Error(`ReassignTasks failed for task ${taskId}: ${message} (code ${code ?? "?"})`);
  }
}

export async function addTaskComment(taskId: number, text: string, folderId: string): Promise<void> {
  const url = `${orchestratorBase()}/odata/TaskNotes/UiPath.Server.Configuration.OData.CreateTaskNote`;
  await uiPost(url, { TaskId: taskId, Text: text }, { "X-UIPATH-OrganizationUnitId": folderId });
}

// --- Task lookup for server-side validation (pages/api/ca-request-reassignment.ts) ---
//
// Core fields via GetTasksAcrossFoldersForAdmin — the exact same admin-scoped
// OData action + $select pattern already proven working in ca-assign-task.ts
// (Id, Status, IsCompleted, IsDeleted, OrganizationUnitId, AssignedToUserId —
// all five appear in ca-assign-task.ts's own TaskItem/$select already; Title
// added here, a standard field on the same entity). Chosen over the classic
// per-folder `odata/Tasks(id)` endpoint specifically because that one
// requires already knowing the task's folder via X-UIPATH-OrganizationUnitId
// — which is one of the things being verified here, so it can't be assumed
// up front.
//
// AssignedToUserId is a bare numeric Orchestrator user id, not an email/name
// — resolving it to something readable reuses getAllOrchestratorUsers()
// (below), the same Users listing getResolvedGroupMembers() already joins
// against, rather than assuming an unverified nested "AssignedToUser" object
// is $select-able through this particular admin-scoped action.
export type TaskCore = {
  Id: number;
  Title?: string;
  Status: string;
  IsCompleted: boolean;
  IsDeleted: boolean;
  OrganizationUnitId: number;
  AssignedToUserId: number | null;
};

export async function getTaskCoreById(taskId: number): Promise<TaskCore | null> {
  const base = `${orchestratorBase()}/odata/Tasks/UiPath.Server.Configuration.OData.GetTasksAcrossFoldersForAdmin`;
  const select = "Id,Title,Status,IsCompleted,IsDeleted,OrganizationUnitId,AssignedToUserId";
  const url = `${base}?$filter=${encodeURIComponent(`Id eq ${taskId}`)}&$select=${select}&$top=1`;
  const data = await uiGet<{ value: TaskCore[] }>(url);
  return (data.value || [])[0] || null;
}

export type OrchestratorUserInfo = { id: number; email: string; name: string };

// Resolves a bare Orchestrator user id (e.g. TaskCore.AssignedToUserId) to an
// email/display name, via the same Users listing already used elsewhere in
// this file. Returns null if the id can't be matched to a user.
export async function getOrchestratorUserById(userId: number): Promise<OrchestratorUserInfo | null> {
  const users = await getAllOrchestratorUsers();
  const u = users.find((x) => x.Id === userId);
  if (!u) return null;
  return {
    id: u.Id,
    email: (u.EmailAddress || u.UserName || "").toLowerCase(),
    name: u.UserName || u.EmailAddress || String(u.Id),
  };
}

// Best-effort fetch of the task's Data payload (case data set by whatever
// created the task) for cross-checking caseId/directoryId. Not part of the
// already-proven $select set above — the classic per-folder entity is tried
// only now that OrganizationUnitId is known, and any failure here (field not
// projectable, permissions, etc.) degrades to "unavailable" rather than
// throwing, since callers treat missing Data as "couldn't verify," not as an
// error — see caller for how that's treated for caseId vs directoryId.
export async function getTaskDataById(taskId: number, organizationUnitId: number): Promise<unknown | null> {
  try {
    const url = `${orchestratorBase()}/odata/Tasks(${taskId})?$select=Data`;
    const data = await uiGet<{ Data?: unknown }>(url, {
      "X-UIPATH-OrganizationUnitId": String(organizationUnitId),
    });
    return data?.Data ?? null;
  } catch (err) {
    console.error(`getTaskDataById(${taskId}) best-effort fetch failed:`, (err as any)?.message || err);
    return null;
  }
}
