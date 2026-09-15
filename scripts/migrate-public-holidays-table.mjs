// scripts/migrate-public-holidays-table.mjs
// Creates the public_holidays table — the DB-backed source of truth for the
// public-holiday In-Office automation (pages/api/cron/holiday-in-office.ts),
// replacing the earlier npm-package-only lookup. Run with:
//   node scripts/migrate-public-holidays-table.mjs
// Same connection pattern as scripts/migrate-assignment-tables.mjs, but reads
// .env.local (this project's actual env file — the older scripts reference a
// plain .env that no longer exists here).
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
create table if not exists public_holidays (
  id           uuid primary key default gen_random_uuid(),
  country_code text not null check (country_code in ('SG', 'MY')),
  holiday_date date not null,
  name         text not null,
  created_at   timestamptz not null default now(),
  last_updated timestamptz not null default now(),
  editor_name  text,
  unique (country_code, holiday_date)
);

-- idempotent for the table as it already existed before last_updated/editor_name were added
alter table public_holidays add column if not exists last_updated timestamptz not null default now();
alter table public_holidays add column if not exists editor_name text;

create index if not exists public_holidays_country_date_idx
  on public_holidays (country_code, holiday_date);
`;

try {
  await client.connect();
  await client.query(sql);
  console.log("public_holidays table ready.");
} catch (err) {
  console.error("Migration failed:", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
