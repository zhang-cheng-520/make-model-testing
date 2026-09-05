# `ca-assign-task` — Workload + In-Office Routing Logic

Documents the actual, tested behavior of [`pages/api/ca-assign-task.ts`](../pages/api/ca-assign-task.ts). This endpoint decides *who* an Action Center task should go to; it does not yet call UiPath's assign API (see "Not yet built" at the end).

## Contract

```
GET/POST /api/ca-assign-task
params/body:
  groupName: string              (required, e.g. "ECICS - SG (BS)")
  mode?: "balanced" | "strict-wip"   (default "balanced")
  folderId?: string               (default CA_FOLDER_ID from .env)

-> 200 {
  groupName, groupId,
  sourceGroup, sourceGroupId,      // which group the assignee actually came from
  fallback: "none" | "case-assigners" | "case-assigners-random",
  mode,
  assigneeEmail,
  tallies: [{ email, name, userId, inProgress, totalAssignedOpen }]
}
```

## Algorithm

### Step 1 — Resolve the group and its candidate pool
1. `groupName` → group `id` via the Identity Group-list endpoint (case-insensitive match on `name` or `displayName`).
2. Group `id` → members via the Identity Group-detail endpoint (`members[]`, filtered to `objectType === "DirectoryUser"`).
3. Members are joined to Orchestrator users (`odata/Users`, matched on `Key` = Identity `identifier`) to get each member's numeric Orchestrator `userId` — required for tallying task assignments. Members that can't be matched to an Orchestrator user are dropped from the candidate pool.

### Step 2 — Filter to "In Office" (Supabase `user_metadata`)
- Each candidate's `in_office` flag is looked up from Supabase by their Identity `identifier`.
- **Default: `true` if no row exists.** A member who has never been touched in the HR Dashboard — including a brand-new member just added to the UiPath group — is treated as in-office. This matches the dashboard's own default and was explicitly confirmed as the intended behavior.
- Only `in_office !== false` candidates proceed to workload scoring.

### Step 3 — Fallback chain (three tiers)

| Tier | Condition | Behavior | `fallback` value |
|---|---|---|---|
| 1 | The requested group has ≥1 in-office candidate | Score & pick within that group | `"none"` |
| 2 | **Nobody** in the requested group is in office (or none matched an Orchestrator user) | Fall back to the fixed group **`"Case Assigners"`**, apply the same in-office filter + workload scoring there | `"case-assigners"` |
| 3 | Nobody in `Case Assigners` is in office either | Pick a **random** member from `Case Assigners`, ignoring workload entirely (there's no meaningful "least loaded" signal left to use) | `"case-assigners-random"` |

`Case Assigners` is a real, existing UiPath Identity group in this tenant (confirmed) — not something that needs to be created. Its group `id` is resolved by name at request time, same as any other group, so renaming it in UiPath would need a matching code change (`FALLBACK_GROUP_NAME` constant).

If tier 2/3 also fails to find any Orchestrator-matched member at all, the endpoint returns `404`.

### Step 4 — Workload scoring (tiers 1 & 2 only)
For the winning candidate pool:
1. Pull all open tasks (`IsCompleted eq false`, `IsDeleted eq false`) in the target Orchestrator folder (`CA_FOLDER_ID`, override via `folderId`).
2. Tally per candidate: `inProgress` = count with `Status === "InProgress"`; `totalAssignedOpen` = all open tasks assigned to them.
3. Sort:
   - `mode: "balanced"` (default): `inProgress` asc → `totalAssignedOpen` asc → name (alphabetical, tie-break)
   - `mode: "strict-wip"`: `inProgress` asc → name (alphabetical, tie-break)
4. Lowest-sorted candidate is `assigneeEmail`. Full `tallies` array is returned for transparency/debugging.

Tier 3 (random fallback) skips this step entirely — `tallies[].inProgress` / `totalAssignedOpen` are returned as `null` in that response to make it visually obvious workload wasn't the basis for the pick.

## Worked examples (from live testing, 2026-09-05)

**Tier 1 — normal case**, `groupName=ECICS - SG (BS)` (sole member `njx@ecics.com.sg`, in office, carrying 23 open tasks elsewhere but 0 in this folder):
```json
{ "sourceGroup": "ECICS - SG (BS)", "fallback": "none", "assigneeEmail": "njx@ecics.com.sg" }
```

**Tier 2 — group empty of in-office members**, after marking `njx` not-in-office:
```json
{ "sourceGroup": "Case Assigners", "fallback": "case-assigners", "assigneeEmail": "rpauser@ecics.com.sg" }
```

**Tier 3 — nobody anywhere is in office**, after also marking Case Assigners' sole member (`rpauser`) not-in-office:
```json
{ "sourceGroup": "Case Assigners", "fallback": "case-assigners-random", "assigneeEmail": "rpauser@ecics.com.sg",
  "tallies": [{ "email": "rpauser@ecics.com.sg", "inProgress": null, "totalAssignedOpen": null }] }
```

## Design decisions worth remembering

- **In-office data lives in Supabase, not UiPath.** UiPath has no concept of it. This endpoint reads the same `user_metadata` table the HR Dashboard writes to (see [PRD-hr-dashboard.md](./PRD-hr-dashboard.md) / [ARCHITECTURE-hr-dashboard.md](./ARCHITECTURE-hr-dashboard.md)) — the two features share state by design.
- **The fallback group is a real UiPath group**, resolved by name, not a hardcoded list of people — so its membership can be managed the normal way (UiPath Admin → Identities → Groups), same as any other group.
- **Random fallback only happens at the very bottom of the chain** — it's a last resort when workload data has nothing useful left to say, not a general tie-breaker.

## Not yet built

This endpoint decides who *should* get a task. It does not call UiPath's Action Center "assign" API to actually push the assignment — that's the next piece, deferred from an earlier discussion (capturing the real `AssignTasks`-style call from the Action Center UI network trace).
