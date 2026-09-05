# PRD — Case Assignment HR Dashboard

## 1. Problem

Today, group membership and workload routing (`ca-assign-task.ts`) rely entirely on UiPath Identity/Orchestrator data. There's no place to see, at a glance, who's in a group, whether they're currently in office, or which internal category/location they belong to (e.g. KL vs SG teams). This context currently lives in people's heads.

## 2. Goal

A small internal web portal ("the Dashboard") that:
- Mirrors UiPath Identity Groups and their members (read-only, always sourced live from UiPath).
- Lets an authorized staff member annotate each member with extra metadata that UiPath has no concept of: in-office status, team category, and location tag.
- Stores that annotation layer in a database (Supabase), keyed to the UiPath user so it survives independently of UiPath but never drifts from who's actually a member.

## 3. Non-goals (v1)

- **No user/member management.** The dashboard cannot add, remove, or invite users. Membership changes only happen in UiPath (Admin → Identities → Groups); the dashboard just reflects them on next load.
- No changes to the existing task-assignment logic (`ca-assign-task.ts`) — this dashboard is a separate, parallel feature for now. (Future: "in office" could feed into workload routing — explicitly out of scope for v1.)
- No self-service category/tag management UI — v1 ships with a fixed, code-defined list of categories/tags (see open question #2).
- No granular RBAC. v1 access control is binary: "is this an authenticated ecics.com.sg user, yes/no." No per-user roles or permissions.
- No audit history UI (we'll store `updated_by`/`updated_at` per row so it's not lost, but no timeline view in v1).

## 4. Users

Internal ECICS staff who manage or oversee Action Center workload/team assignment — likely a handful of people, not the whole org. Anyone who can sign in with an `@ecics.com.sg` Microsoft account gets access in v1.

## 5. Functional requirements

### 5.1 Login
- Kept intentionally simple for v1: one fixed, hardcoded credential pair (e.g. `admin@dashboard.com` / `Password123`, stored in env vars, not a user table), gating the whole `/dashboard`. No self-registration, no per-real-person accounts, no OAuth.
- Consequence: edits aren't attributed to a specific person in v1 (no real per-user identity behind the single shared login) — see §5.5.

### 5.2 Dashboard home — group picker
- Shows the list of UiPath Identity Groups (same data as `https://cloud.uipath.com/ifsgrptech/portal_/admin/identities/groups`), **excluding built-ins** (`Everyone`, `Automation Users`, `Administrators`, `Citizen Developers`, `Automation Developers`, `Automation Express`, etc.). Confirmed discriminator: the Group API returns `"type": 0` for built-ins and `"type": 1` for custom groups — filter to `type === 1`.
- User selects a group (e.g. `ECICS - SG (BS)`).

### 5.3 Group member table
On selecting a group, show a table (styled like the shadcn admin users table) with one row per member:

| Column | Source | Editable? |
|---|---|---|
| Name | UiPath (Identity/Orchestrator) | No |
| Email | UiPath (Identity/Orchestrator) | No |
| In Office | Supabase (`user_metadata`) | Yes — toggle/radio, default **In Office** |
| Categories | Supabase (`user_metadata`) | Yes — **multi-select** from a fixed, hardcoded list: `KL - Team BAU`, `KL - Team RPA`, `SG Team - BAU`, `SG`, `MY`. A member can carry more than one (e.g. a team category plus a standalone location tag). |

- Edits are staged in the table and saved via an **explicit Save action per row** (not autosave) — matches PRD open question #3, now resolved.
- If a member has no metadata row yet, the table still shows them (from UiPath) with defaults (`In Office = true`, no categories) — nothing UiPath-side is ever blocked by missing metadata.

### 5.5 Audit (lightweight, v1)
Since v1 login has no per-user identity, `updated_by` is nullable/blank. If per-editor attribution becomes important later, it requires moving off the shared-password model to some form of per-user login — explicitly deferred, not solved in v1.

### 5.4 Data integrity rule
The dashboard must never become a second source of truth for "who is in this group." Every page load (or on a refresh action) re-pulls the member list from UiPath live; Supabase only supplies the annotation columns, joined by identifier. If someone is removed from the UiPath group, they disappear from the table on next refresh — their old metadata row can simply become orphaned/unused (no need to delete it).

## 6. Decisions (validated)

1. **Login** — one fixed, hardcoded email/password credential pair (e.g. `admin@dashboard.com` / `Password123`), no OAuth, no per-user identity. Simplest possible v1 gate.
2. **Category list** — fixed hardcoded list in code: `KL - Team BAU`, `KL - Team RPA`, `SG Team - BAU`, `SG`, `MY`. No admin UI to manage it in v1.
3. **Save behavior** — explicit Save action per row, not autosave.
4. **Which groups show up** — only custom groups (`type === 1`); built-ins are filtered out.
5. **Categories vs Tags** — merged into one field, "Categories," multi-select, covering both team and location values.
