// scripts/migrate-leave-and-status-tables.mjs
// Adds:
//   1. user_metadata.in_office_reason — the reason behind the current
//      in_office value (Normal / Manual / LOA / Urgent Leave / Medical Leave
//      / SG Public Holiday / MY Public Holiday / SG + MY Public Holiday —
//      see lib/inOfficeReasons.ts). Backfilled once for existing rows; the
//      very next daily status refresh (lib/dailyStatusRefresh.ts) overwrites
//      it properly within 24h regardless, so the backfill is only a
//      best-effort guess to avoid a blank column in the meantime.
//   2. leave_periods — the LOA Management Portal's table of planned leave.
// Same connection pattern as scripts/migrate-public-holidays-table.mjs
// (reads .env.local via SUPABASE_PROJECT_REF / SUPABASE_DB_PASSWORD). Run with:
//   node scripts/migrate-leave-and-status-tables.mjs
//
// uipath_id is `text` (not bigint) to match user_metadata.uipath_id — it's
// the UiPath Identity member.identifier (a GUID-like string), not a numeric
// Orchestrator id. id is `uuid` to match the existing user_metadata /
// public_holidays convention, not bigserial.
import pg from "pg";
import fs from "fs";

const envPath = new URL("../.env.local", import.meta.url);
const envText = fs.readFileSync(envPath, "utf8");
const get = (key) => {
  const m = envText.match(new RegExp(`^${key}\\s*=\\s*(.+)$`, "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
};

const projectRef = get("SUPABASE_PROJECT_REF");
const dbPassword = get("SUPABASE_DB_PASSWORD");

const connectionString = `postgresql://postgres.${projectRef}:${encodeURIComponent(dbPassword)}@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`;

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

const sql = `
alter table user_metadata add column if not exists in_office_reason text;

update user_metadata
set in_office_reason = case when in_office then 'Normal' else 'Manual' end
where in_office_reason is null;

create table if not exists leave_periods (
  id           uuid primary key default gen_random_uuid(),
  uipath_id    text not null,
  email        text,
  leave_type   text not null default 'LOA',
  start_date   date not null,
  end_date     date not null,
  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   text,
  constraint leave_periods_valid_dates check (end_date >= start_date)
);

create index if not exists leave_periods_uipath_id_idx
  on leave_periods (uipath_id);

create index if not exists leave_periods_uipath_id_date_range_idx
  on leave_periods (uipath_id, start_date, end_date);
`;

try {
  await client.connect();
  await client.query(sql);
  console.log("user_metadata.in_office_reason and leave_periods are ready.");
} catch (err) {
  console.error("Migration failed:", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
