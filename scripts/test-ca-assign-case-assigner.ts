// scripts/test-ca-assign-case-assigner.ts
//
// Offline tests for /api/ca-assign-case-assigner (plus one /api/ca-assign-task regression).
// global fetch is a stub serving fake UiPath Identity / Orchestrator / Supabase responses,
// so nothing real is called.   Run: npx tsx scripts/test-ca-assign-case-assigner.ts

process.env.CA_ORG = "org";
process.env.CA_TENANT = "tenant";
process.env.CA_FOLDER_ID = "1033718";
process.env.CA_ORCHESTRATOR_PAT = "pat";
process.env.CA_IDENTITY_ORG_ID = "idorg";
process.env.SUPABASE_URL = "https://supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";

type Member = { id: string; email: string; name: string; userId: number; inOffice?: boolean; inProgress?: number; open?: number };
type Scenario = {
  groups: Record<string, Member[]>; // group name -> members
  pending?: Record<number, number>;
  fail?: "identity" | "members" | "users" | "tasks" | "supabase";
};

let scenario: Scenario = { groups: {} };
let calls: string[] = [];

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const groupId = (name: string) => "g-" + name.toLowerCase().replace(/\W+/g, "-");
const allMembers = () => Object.values(scenario.groups).flat();

(globalThis as any).fetch = async (input: any, init: any = {}) => {
  const url = typeof input === "string" ? input : input.url;
  const method = (init.method || "GET").toUpperCase();
  calls.push(`${method} ${url}`);
  const u = new URL(url);

  if (u.host === "cloud.uipath.com" && u.pathname === "/org/identity_/api/Group/idorg") {
    if (scenario.fail === "identity") return json(500, { error: "identity down" });
    return json(200, Object.keys(scenario.groups).map((name) => ({ id: groupId(name), name })));
  }
  if (u.host === "cloud.uipath.com" && u.pathname.startsWith("/org/identity_/api/Group/idorg/")) {
    if (scenario.fail === "members") return json(503, { error: "identity down" });
    const name = Object.keys(scenario.groups).find((n) => groupId(n) === u.pathname.split("/").pop());
    const members = (scenario.groups[name || ""] || []).map((m) => ({
      objectType: "DirectoryUser",
      identifier: m.id,
      email: m.email,
      displayName: m.name,
    }));
    return json(200, { members });
  }
  if (u.host === "cloud.uipath.com" && u.pathname === "/org/tenant/orchestrator_/odata/Users") {
    if (scenario.fail === "users") return json(401, { error: "unauthorized" });
    return json(200, {
      value: allMembers().map((m) => ({ Id: m.userId, EmailAddress: m.email, UserName: m.email, Key: m.id, Type: "DirectoryUser" })),
    });
  }
  if (u.host === "cloud.uipath.com" && u.pathname.includes("GetTasksAcrossFoldersForAdmin")) {
    if (scenario.fail === "tasks") return json(500, { error: "orchestrator down" });
    const value: any[] = [];
    let id = 1;
    for (const m of allMembers()) {
      for (let i = 0; i < (m.inProgress || 0); i++) value.push({ Id: id++, AssignedToUserId: m.userId, Status: "InProgress" });
      for (let i = 0; i < (m.open || 0); i++) value.push({ Id: id++, AssignedToUserId: m.userId, Status: "Pending" });
    }
    return json(200, { value });
  }
  if (u.host === "supabase.test") {
    if (scenario.fail === "supabase") return json(500, { message: "db down" });
    if (u.pathname === "/rest/v1/user_metadata") {
      return json(200, allMembers().filter((m) => m.inOffice !== undefined).map((m) => ({ uipath_id: m.id, in_office: m.inOffice })));
    }
    if (u.pathname === "/rest/v1/rpc/try_acquire_lock") return json(200, true);
    if (u.pathname === "/rest/v1/rpc/release_lock") return new Response(null, { status: 204 });
    if (u.pathname === "/rest/v1/pending_assignments") {
      if (method === "DELETE" || method === "POST") return new Response(null, { status: method === "POST" ? 201 : 204 });
      const rows: { user_id: number }[] = [];
      for (const [uid, n] of Object.entries(scenario.pending || {})) for (let i = 0; i < n; i++) rows.push({ user_id: +uid });
      return json(200, rows);
    }
  }
  throw new Error(`unexpected fetch ${method} ${url}`);
};

function makeRes() {
  const res: any = { statusCode: 0, payload: null };
  res.status = (c: number) => ((res.statusCode = c), res);
  res.json = (p: unknown) => ((res.payload = p), res);
  return res;
}

const CA = "Case Assigners";
const alice: Member = { id: "u-a", email: "assigner.a@example.test", name: "Assigner A", userId: 11 };
const bob: Member = { id: "u-b", email: "assigner.b@example.test", name: "Assigner B", userId: 12 };
const cara: Member = { id: "u-c", email: "assigner.c@example.test", name: "Assigner C", userId: 13 };
const rpa: Member = { id: "u-rpa", email: "rpauser@ecics.com.sg", name: "RPA User", userId: 99 };

type Case = {
  name: string;
  route?: "case-assigner" | "assign-task";
  query?: Record<string, string>;
  scenario: Scenario;
  status: number;
  assignee?: string | null;
  fallback?: string;
  fallbackReason?: string | null;
  lock?: boolean;
  reserved?: boolean;
  tallyExcludesRpa?: boolean;
  noCalls?: boolean;
  taskFolder?: string;
};

const cases: Case[] = [
  {
    name: "1 one in-office member -> that member",
    scenario: { groups: { [CA]: [{ ...alice, inOffice: true }] } },
    status: 200, assignee: alice.email, fallback: "none", fallbackReason: null, lock: true, reserved: true,
  },
  {
    name: "1b member with no user_metadata row counts as in office (existing default)",
    scenario: { groups: { [CA]: [{ ...alice }] } },
    status: 200, assignee: alice.email, fallback: "none",
  },
  {
    name: "2a several in office -> fewest in-progress wins",
    scenario: { groups: { [CA]: [{ ...alice, inOffice: true, inProgress: 2 }, { ...bob, inOffice: true, inProgress: 0, open: 5 }, { ...cara, inOffice: true, inProgress: 1 }] } },
    status: 200, assignee: bob.email, fallback: "none", lock: true, reserved: true,
  },
  {
    name: "2b tie on in-progress -> fewest open (incl. pending reservations) wins",
    scenario: { groups: { [CA]: [{ ...alice, inOffice: true, open: 1 }, { ...bob, inOffice: true, open: 0 }, { ...cara, inOffice: true, open: 0 }] }, pending: { 12: 2 } },
    status: 200, assignee: cara.email, fallback: "none",
  },
  {
    name: "2c out-of-office member is never picked even if idle",
    scenario: { groups: { [CA]: [{ ...alice, inOffice: false }, { ...bob, inOffice: true, inProgress: 3 }] } },
    status: 200, assignee: bob.email, fallback: "none",
  },
  {
    name: "3 all members out of office -> RPA account",
    scenario: { groups: { [CA]: [{ ...alice, inOffice: false }, { ...bob, inOffice: false }] } },
    status: 200, assignee: "rpauser@ecics.com.sg", fallback: "rpa-account", fallbackReason: "none-in-office", lock: false, reserved: false,
  },
  {
    name: "4 group empty -> RPA account",
    scenario: { groups: { [CA]: [] } },
    status: 200, assignee: "rpauser@ecics.com.sg", fallback: "rpa-account", fallbackReason: "group-empty", lock: false, reserved: false,
  },
  {
    name: "RPA member is excluded from balancing even when idle and in office",
    scenario: { groups: { [CA]: [{ ...rpa, inOffice: true }, { ...alice, inOffice: true, inProgress: 4, open: 9 }] } },
    status: 200, assignee: alice.email, fallback: "none", lock: true, reserved: true, tallyExcludesRpa: true,
  },
  {
    name: "RPA member with different email casing is still excluded",
    scenario: { groups: { [CA]: [{ ...rpa, email: "RPAUser@ECICS.com.sg", inOffice: true }, { ...bob, inOffice: true, inProgress: 2 }] } },
    status: 200, assignee: bob.email, fallback: "none", tallyExcludesRpa: true,
  },
  {
    name: "only the RPA account in the group -> RPA fallback as group-empty (not a balanced pick)",
    scenario: { groups: { [CA]: [{ ...rpa, inOffice: true }] } },
    status: 200, assignee: "rpauser@ecics.com.sg", fallback: "rpa-account", fallbackReason: "group-empty", lock: false, reserved: false, tallyExcludesRpa: true,
  },
  {
    name: "RPA in group + others out of office -> RPA fallback none-in-office",
    scenario: { groups: { [CA]: [{ ...rpa, inOffice: true }, { ...alice, inOffice: false }] } },
    status: 200, assignee: "rpauser@ecics.com.sg", fallback: "rpa-account", fallbackReason: "none-in-office", lock: false, reserved: false, tallyExcludesRpa: true,
  },
  {
    name: "RPA removed from group, nobody in office -> RPA fallback still returned",
    scenario: { groups: { [CA]: [{ ...alice, inOffice: false }] } },
    status: 200, assignee: "rpauser@ecics.com.sg", fallback: "rpa-account", fallbackReason: "none-in-office",
  },
  { name: "5a Identity group list fails -> 500, no RPA", scenario: { groups: { [CA]: [alice] }, fail: "identity" }, status: 500, assignee: undefined },
  { name: "5b group members fail -> 500, no RPA", scenario: { groups: { [CA]: [alice] }, fail: "members" }, status: 500, assignee: undefined },
  { name: "5c Orchestrator users fail -> 500, no RPA", scenario: { groups: { [CA]: [alice] }, fail: "users" }, status: 500, assignee: undefined },
  { name: "5d Orchestrator tasks fail -> 500, no RPA", scenario: { groups: { [CA]: [{ ...alice, inOffice: true }] }, fail: "tasks" }, status: 500, assignee: undefined },
  { name: "5e Supabase in-office lookup fails -> 500, no RPA", scenario: { groups: { [CA]: [alice] }, fail: "supabase" }, status: 500, assignee: undefined },
  { name: "5f group name not found -> 404, no RPA", scenario: { groups: { "Other Group": [alice] } }, status: 404, assignee: undefined },
  {
    name: "explicit groupName/folderId/mode are honoured",
    query: { groupName: "case assigners", folderId: "1033718", mode: "balanced" },
    scenario: { groups: { [CA]: [{ ...alice, inOffice: true }] } },
    status: 200, assignee: alice.email,
  },
  {
    name: "missing folderId -> 400, no UiPath/Supabase call (no CA_FOLDER_ID default)",
    query: { groupName: "Case Assigners" },
    scenario: { groups: { [CA]: [{ ...alice, inOffice: true }] } },
    status: 400, assignee: undefined, noCalls: true,
  },
  {
    name: "non-numeric folderId -> 400, no UiPath/Supabase call",
    query: { folderId: "Case Assignment Testing" },
    scenario: { groups: { [CA]: [{ ...alice, inOffice: true }] } },
    status: 400, assignee: undefined, noCalls: true,
  },
  {
    name: "Live folderId is passed through to the workload query",
    query: { folderId: "1048073" },
    scenario: { groups: { [CA]: [{ ...alice, inOffice: true }] } },
    status: 200, assignee: alice.email, taskFolder: "1048073",
  },
  {
    name: "regression: ca-assign-task still falls back SG -> MY (paired group)",
    route: "assign-task",
    query: { groupName: "ECICS - SG (BS)", folderId: "1033718" },
    scenario: { groups: { "ECICS - SG (BS)": [{ ...alice, inOffice: false }], "ECICS - MY (BS)": [{ ...bob, inOffice: true }], [CA]: [{ ...cara, inOffice: true }] } },
    status: 200, assignee: bob.email, fallback: "paired-group",
  },
  {
    name: "regression: ca-assign-task still picks a random Case Assigner when none in office",
    route: "assign-task",
    query: { groupName: "ECICS - RPA (BS)", folderId: "1033718" },
    scenario: { groups: { "ECICS - RPA (BS)": [{ ...alice, inOffice: false }], [CA]: [{ ...cara, inOffice: false }] } },
    status: 200, assignee: cara.email, fallback: "case-assigners-random",
  },
];

async function main() {
  const { default: caseAssigner } = await import("../pages/api/ca-assign-case-assigner");
  const { default: assignTask } = await import("../pages/api/ca-assign-task");
  const quiet = { log: console.log, error: console.error };
  let failed = 0;
  for (const c of cases) {
    scenario = c.scenario;
    calls = [];
    const res = makeRes();
    console.log = () => {};
    console.error = () => {};
    try {
      const query = c.query ?? (c.route === "assign-task" ? {} : { folderId: "1033718" });
      await (c.route === "assign-task" ? assignTask : caseAssigner)({ method: "GET", query, headers: {} } as any, res);
    } finally {
      console.log = quiet.log;
      console.error = quiet.error;
    }
    const p = res.payload || {};
    const lock = calls.some((u) => u.includes("rpc/try_acquire_lock"));
    const reserved = calls.some((u) => u.startsWith("POST https://supabase.test/rest/v1/pending_assignments"));
    const problems: string[] = [];
    if (res.statusCode !== c.status) problems.push(`status ${res.statusCode}`);
    if (c.assignee !== undefined && p.assigneeEmail !== c.assignee) problems.push(`assignee ${p.assigneeEmail}`);
    if (c.assignee === undefined && p.assigneeEmail !== undefined) problems.push(`unexpected assignee ${p.assigneeEmail}`);
    if (c.fallback !== undefined && p.fallback !== c.fallback) problems.push(`fallback ${p.fallback}`);
    if (c.fallbackReason !== undefined && p.fallbackReason !== c.fallbackReason) problems.push(`fallbackReason ${p.fallbackReason}`);
    if (c.lock !== undefined && lock !== c.lock) problems.push(`lock ${lock}`);
    if (c.reserved !== undefined && reserved !== c.reserved) problems.push(`reserved ${reserved}`);
    if (c.route !== "assign-task" && /paired|random/.test(JSON.stringify(p.fallback || ""))) problems.push("paired/random fallback used");
    if (c.noCalls && calls.length) problems.push(`${calls.length} upstream calls made`);
    if (c.taskFolder && !calls.some((u) => u.includes("GetTasksAcrossFoldersForAdmin") && u.includes(encodeURIComponent("OrganizationUnitId eq " + c.taskFolder)))) problems.push("workload not read from folder " + c.taskFolder);
    if (c.taskFolder && p.folderId !== c.taskFolder) problems.push("response folderId " + p.folderId);
    if (c.tallyExcludesRpa && (p.tallies || []).some((t: any) => /^rpauser@ecics\.com\.sg$/i.test(t.email))) problems.push("RPA account appears in tallies");
    if (c.route !== "assign-task" && res.statusCode === 200 && typeof p.assigneeEmail !== "string") problems.push("assigneeEmail missing");
    console.log(`${problems.length ? "FAIL" : "PASS"}  ${c.name}  -> ${res.statusCode} ${p.assigneeEmail ?? p.error?.slice(0, 50)}${problems.length ? "  :: " + problems.join("; ") : ""}`);
    if (problems.length) failed++;
  }
  console.log(`\n${cases.length - failed}/${cases.length} passed`);
  process.exitCode = failed ? 1 : 0;
}

main();
