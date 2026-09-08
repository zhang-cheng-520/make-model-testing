import pg from "pg";
import fs from "fs";

const envPath = new URL("../.env", import.meta.url);
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
create table if not exists assignment_locks (
  group_id text primary key,
  locked_until timestamptz not null default now()
);

create table if not exists pending_assignments (
  id bigint generated always as identity primary key,
  group_id text not null,
  user_id bigint not null,
  email text not null,
  reserved_at timestamptz not null default now()
);

create index if not exists pending_assignments_group_reserved_idx
  on pending_assignments (group_id, reserved_at);
`;

try {
  await client.connect();
  await client.query(sql);
  console.log("Migration applied successfully.");
} catch (err) {
  console.error("Migration failed:", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
