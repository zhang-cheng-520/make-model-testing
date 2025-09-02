import type { NextApiRequest, NextApiResponse } from "next";

/**
 * ENV REQUIRED:
 *  UIPATH_TOKEN=<your bearer token>
 */
const TOKEN = process.env.UIPATH_TOKEN || "rt_85511362FCFE6AA8BC50B50FA3F36D9B051EA844239102C1DD05764C7F94BB71-1";

// Tenant/account constants
const ACCOUNT = "ecicsxdqonrj";
const TENANT = "DefaultTenant";

// Identity (group)
const ORG_ID = "1efb5f86-17ed-44d3-b3f5-b29b68502dea";
const GROUP_ID = "4225e926-5732-44b0-9021-055cc3452241";

// Orchestrator folder (Ecics)
const FOLDER_ID = 847179;

// ------------------------ helpers ------------------------

async function uiGet<T>(url: string): Promise<T> {
  if (!TOKEN) throw new Error("UIPATH_TOKEN is missing");
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText} for ${url}\n${body}`);
  }
  return res.json();
}

// Compute today's start/end **UTC** boundaries for the Singapore (UTC+08:00) day
function getTodaySgtUtcWindow() {
  // Get SGT's current date parts
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [{ value: y }, , { value: m }, , { value: d }] = fmt.formatToParts(now);

  // Build SGT midnight (YYYY-MM-DDT00:00:00+08:00)
  const sgtMidnight = new Date(`${y}-${m}-${d}T00:00:00+08:00`);
  const startUtcIso = sgtMidnight.toISOString(); // start inclusive
  const endUtcIso = new Date(sgtMidnight.getTime() + 24 * 60 * 60 * 1000).toISOString(); // end exclusive
  // OData works with bare ISO (no quotes) for datetimeoffsets in filters in your tenant
  return { startUtc: startUtcIso, endUtc: endUtcIso };
}

type IdentityMember = {
  identifier: string; // GUID (maps to Users.Key)
  email?: string;
  displayName?: string;
};

async function getGroupMembers(): Promise<IdentityMember[]> {
  const url = `https://cloud.uipath.com/${ACCOUNT}/identity_/api/Group/${ORG_ID}/${GROUP_ID}`;
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

type OrchestratorUser = {
  Id: number;
  EmailAddress?: string;
  UserName?: string;
  Key: string; // GUID (matches Identity.identifier)
  Type?: string; // "DirectoryUser", "DirectoryGroup", etc.
};

async function getAllUsers(): Promise<OrchestratorUser[]> {
  const url = `https://cloud.uipath.com/${ACCOUNT}/${TENANT}/orchestrator_/odata/Users?$top=100&$select=Id,EmailAddress,UserName,Key,Type`;
  const data = await uiGet<{ value: OrchestratorUser[] }>(url);
  return data.value || [];
}

type TaskItem = {
  Id: number;
  AssignedToUserId: number | null;
  Status: string;
  IsCompleted: boolean;
  CreationTime: string;
  OrganizationUnitId: number;
};

async function getOpenTasksInEcicsToday(): Promise<TaskItem[]> {
  const base = `https://cloud.uipath.com/${ACCOUNT}/${TENANT}/orchestrator_/odata/Tasks/UiPath.Server.Configuration.OData.GetTasksAcrossFoldersForAdmin`;
  const select =
    "Id,Status,IsCompleted,CreationTime,AssignedToUserId,OrganizationUnitId";

  const { startUtc, endUtc } = getTodaySgtUtcWindow();
  // Example filter produced:
  // OrganizationUnitId eq 847179 and IsCompleted eq false and CreationTime ge 2025-08-27T16:00:00.000Z and CreationTime lt 2025-08-28T16:00:00.000Z
  const filter =
    `OrganizationUnitId eq ${FOLDER_ID} and IsCompleted eq false` +
    ` and CreationTime ge ${startUtc} and CreationTime lt ${endUtc}`;

  const url = `${base}?$top=1000&$count=true&$select=${encodeURIComponent(
    select
  )}&$filter=${encodeURIComponent(filter)}`;

  const data = await uiGet<{ value: TaskItem[] }>(url);
  return data.value || [];
}

function alphaName(a: string, b: string) {
  return a.localeCompare(b, "en", { sensitivity: "base" });
}

// ------------------------ policy logic ------------------------

/**
 * Policy 1 (default):
 *   1) Fewest InProgress
 *   2) Then fewest total open assigned
 *   3) Then alphabetical by display name
 *
 * Policy 2 (strict-wip):
 *   1) Fewest InProgress
 *   2) Then alphabetical
 */
function pickLeastLoaded(
  candidates: { email: string; userId: number; name: string }[],
  tasks: TaskItem[],
  mode: "strict-wip" | "balanced" = "balanced"
) {
  // Build quick index of tasks by user
  const byUser: Record<number, TaskItem[]> = {};
  for (const t of tasks) {
    if (t.AssignedToUserId == null) continue; // ignore unassigned
    const uid = t.AssignedToUserId;
    (byUser[uid] ||= []).push(t);
  }

  // Calculate metrics for each candidate
  const scored = candidates.map((c) => {
    const mine = byUser[c.userId] || [];
    const inProgress = mine.filter((t) => t.Status === "InProgress").length;
    const totalAssignedOpen = mine.length; // all open assigned, since IsCompleted=false in the fetch
    return { ...c, inProgress, totalAssignedOpen };
  });

  // Sort by policy
  if (mode === "strict-wip") {
    scored.sort(
      (a, b) =>
        a.inProgress - b.inProgress ||
        alphaName(a.name || a.email, b.name || b.email)
    );
  } else {
    // balanced (Policy 1)
    scored.sort(
      (a, b) =>
        a.inProgress - b.inProgress ||
        a.totalAssignedOpen - b.totalAssignedOpen ||
        alphaName(a.name || a.email, b.name || b.email)
    );
  }

  const selected = scored[0] || null;
  return { selected, tallies: scored };
}

// ------------------------ API handler ------------------------

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // Optional ?mode=strict-wip ; default is "balanced" (Policy 1)
    const modeParam = (req.query.mode as string | undefined)?.toLowerCase();
    const mode: "strict-wip" | "balanced" =
      modeParam === "strict-wip" ? "strict-wip" : "balanced";

    // 1) Eligible users (Identity group)
    const members = await getGroupMembers();

    // 2) Map to Orchestrator users (GUID join)
    const allUsers = await getAllUsers();
    const userByKey = new Map(
      allUsers
        .filter((u) => u.Type === "DirectoryUser")
        .map((u) => [u.Key.toLowerCase(), u])
    );

    const candidates = members
      .map((m) => {
        const u = userByKey.get(m.identifier.toLowerCase());
        return {
          email: (m.email || u?.EmailAddress || u?.UserName || "").toLowerCase(),
          name: m.displayName || u?.UserName || u?.EmailAddress || "",
          userId: u?.Id as number | undefined,
        };
      })
      .filter((c) => typeof c.userId === "number" && c.email) as {
      email: string;
      name: string;
      userId: number;
    }[];

    // 3) Today’s open tasks in Ecics (SGT day)
    const tasks = await getOpenTasksInEcicsToday();

    // 4) Pick least-loaded per policy
    const { selected, tallies } = pickLeastLoaded(candidates, tasks, mode);

    return res.status(200).json({
    //   assigneeEmail: selected?.email || null, // flat field for Maestro
    //   selected: selected
    //     ? {
    //         email: selected.email,
    //         userId: selected.userId,
    //         name: selected.name,
    //         workload: {
    //           inProgress: selected.inProgress,
    //           openAssigned: selected.totalAssignedOpen,
    //         },
    //       }
    //     : null,
    //   tallies: tallies.map((t) => ({
    //     email: t.email,
    //     userId: t.userId,
    //     name: t.name,
    //     workload: {
    //       inProgress: t.inProgress,
    //       openAssigned: t.totalAssignedOpen,
    //     },
    //   })),
    //   basis: {
    //     folderId: FOLDER_ID,
    //     day: "today (SGT)",
    //     policy: mode === "strict-wip" ? "Policy 2: strict-wip" : "Policy 1: balanced",
    //     filter:
    //       "IsCompleted eq false AND CreationTime within today's SGT window",
    //     totals: { openTasksToday: tasks.length, groupSize: candidates.length },
    //   },
        assigneeEmail: selected?.email || null, // flat field for Maestro

    });
  } catch (err: any) {
    console.error("least-loaded error:", err?.message || err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
