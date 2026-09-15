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
