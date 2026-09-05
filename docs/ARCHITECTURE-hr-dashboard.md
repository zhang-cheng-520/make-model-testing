# Architecture — Case Assignment HR Dashboard

Companion to [PRD-hr-dashboard.md](./PRD-hr-dashboard.md). Describes how the dashboard fits into the existing `api-agent-make-model-test` Next.js project.

## 1. Current state of the repo (relevant facts)

- Next.js **Pages Router**, no UI yet — the project today is API-routes-only (`pages/api/*.ts`). No Tailwind, no component library, no `pages/_app.tsx`, no global CSS.
- UiPath access for this feature already lives in `.env` and is proven working via `ca-assign-task.ts`: `CA_ORG`, `CA_TENANT`, `CA_FOLDER_ID`, `CA_ORCHESTRATOR_PAT`, `CA_IDENTITY_ORG_ID`.
- `middleware.ts` currently only matches `/api/:path*` and is a no-op passthrough — will need real logic for protecting dashboard pages/routes.
- **Login decision (validated):** v1 does *not* use the existing Azure AD app registration — that idea is dropped in favor of one fixed, hardcoded email/password credential pair, kept as simple as possible. The Azure AD app stays scoped to its existing Teams/Graph use only.

## 2. New pieces to add

### 2.1 UI layer
- Add Tailwind CSS + shadcn/ui to the project (`components.json`, `tailwind.config`, `pages/_app.tsx`, `styles/globals.css`).
- New pages (Pages Router):
  - `pages/dashboard/index.tsx` — group picker + member table (single page, group selection changes table content client-side; matches the reference shadcn admin layout).
  - `pages/login.tsx` — simple "Sign in with Microsoft" button.
- Shared UI in `components/` (shadcn table, select, switch/radio, badge for tags).

### 2.2 Auth (simple, v1)
- `pages/login.tsx` — email + password form, posts to `pages/api/auth/dashboard-login.ts`.
- `pages/api/auth/dashboard-login.ts` — compares the submitted `{ email, password }` against one fixed, hardcoded pair from server env vars (`DASHBOARD_LOGIN_EMAIL`, `DASHBOARD_LOGIN_PASSWORD` — placeholder values `admin@dashboard.com` / `Password123` for v1). On match, sets a signed **httpOnly session cookie** (JWT via `jose`, already in `package.json`) containing just `{ authenticated: true, exp }` — no real per-user identity behind it, by design (PRD §5.5).
- `middleware.ts` — extend the matcher to also cover `/dashboard/:path*`, verify the session cookie, redirect to `/login` if absent/invalid. API routes under `/api/dashboard/*` also check the cookie server-side.
- No Azure AD, no OAuth round-trip, no external identity provider involved in v1.

### 2.3 UiPath read layer (server-side only, reuses existing pattern from `ca-assign-task.ts`)
- `pages/api/dashboard/groups.ts` — `GET`, wraps `identity_/api/Group/{CA_IDENTITY_ORG_ID}`, filters to `type === 1` (excludes built-ins — confirmed against the Admin UI screenshot: `Everyone`, `Automation Users`, `Administrators`, `Citizen Developers`, `Automation Developers`, `Automation Express` are all `type: 0`), returns `{ id, name, displayName }[]`.
- `pages/api/dashboard/groups/[groupId]/members.ts` — `GET`, wraps `identity_/api/Group/{CA_IDENTITY_ORG_ID}/{groupId}`, cross-referenced with Orchestrator `odata/Users` (same join logic already written in `ca-assign-task.ts`'s `getGroupMembers` + `getAllUsers`) to produce canonical `{ identifier, name, email }[]`.
- These two routes are pure reads from UiPath — no writes, no caching layer needed for v1 (traffic is low; live data is more valuable than staleness here per PRD §5.4).

### 2.4 Metadata store — Supabase
New Supabase project/table, accessed **only from Next.js API routes** using the Supabase **service role key** (server env var, never sent to the browser). The browser never talks to Supabase directly in v1 — keeps the security model identical to how UiPath's PAT is handled today (server-side secret, proxied through Next API routes).

```sql
create table user_metadata (
  id           uuid primary key default gen_random_uuid(),
  uipath_id    text unique not null,      -- Identity API member.identifier — stable join key
  email        text,                      -- denormalized, for convenience/search only
  in_office    boolean not null default true,
  categories   text[] default '{}',       -- multi-select from the fixed v1 list, e.g. {'SG Team - BAU','MY'}
  updated_at   timestamptz not null default now(),
  updated_by   text                       -- nullable in v1 — no per-user identity to stamp (PRD §5.5)
);
```

Fixed v1 category list (hardcoded in code, not DB-managed): `KL - Team BAU`, `KL - Team RPA`, `SG Team - BAU`, `SG`, `MY`.

- `pages/api/dashboard/metadata.ts` — `GET ?groupId=...` (returns metadata rows for a set of `uipath_id`s) and `PATCH` (upsert one row: `{ uipathId, inOffice?, categories? }`). Since save is **explicit per row** (not autosave — PRD §5.3), the client batches a row's edits into one `PATCH` call on Save.
- New env vars: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DASHBOARD_LOGIN_EMAIL`, `DASHBOARD_LOGIN_PASSWORD`, `DASHBOARD_SESSION_SECRET`.

### 2.5 Client data flow

```
Dashboard page
  → GET /api/dashboard/groups                 (UiPath, live)
  → user picks a group
  → GET /api/dashboard/groups/{id}/members     (UiPath, live)
  → GET /api/dashboard/metadata?groupId={id}   (Supabase)
  → merge client-side by uipath_id / identifier → render table
  → user edits a cell
  → PATCH /api/dashboard/metadata              (Supabase upsert)
  → optimistic UI update
```

No member list is ever written to Supabase — only the annotation columns, joined at render time. This directly enforces PRD §5.4 (UiPath stays the sole source of truth for membership).

## 3. Security notes

- UiPath PAT (`CA_ORCHESTRATOR_PAT`) and Supabase service role key both stay server-side, same as the existing `ca-*` routes — never exposed to the browser bundle.
- Session cookie is httpOnly + signed, short expiry (e.g. 8h), re-auth via Microsoft when expired.
- `middleware.ts` becomes the single gate for both dashboard pages and dashboard API routes — worth double-checking it can't be bypassed by hitting `/api/dashboard/*` directly without a valid cookie.

## 4. Deployment

- Same target as the rest of this repo (Vercel, per existing `VERCEL_*` env vars). New env vars to add there: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DASHBOARD_LOGIN_EMAIL`, `DASHBOARD_LOGIN_PASSWORD`, `DASHBOARD_SESSION_SECRET`.

## 5. Status

All v1 decisions are validated (see PRD §6) — no open questions remain. Implementation is done (see §6).

## 6. Implementation notes (as built)

- Tailwind is pinned to **v3** (`tailwind.config.js` + `postcss.config.js` use the v3 recipe) — `npm install tailwindcss` alone pulls v4, which is incompatible with this setup and will break the PostCSS build. Don't let it drift to v4 on a future `npm install`/`npm update` without also migrating the config.
- UI primitives are hand-rolled shadcn-style components (`components/ui/*`) rather than pulled via the `shadcn` CLI (which needs an interactive TTY this environment doesn't have) — same visual/API contract, just authored directly.
- Categories are implemented as toggle-able chips (`components/category-picker.tsx`), not a dropdown — simpler and avoids an extra Radix/cmdk dependency for a 5-item fixed list.
- **Cross-feature dependency:** [`pages/api/ca-assign-task.ts`](../pages/api/ca-assign-task.ts) (the workload-routing endpoint from the earlier phase of this project) now reads the same `user_metadata.in_office` column this dashboard writes. See [ca-assign-task-logic.md](./ca-assign-task-logic.md) for the full routing/fallback logic this enables. The two features are not independent — changes to the `user_metadata` schema affect both.
