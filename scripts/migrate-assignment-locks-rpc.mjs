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

// try_acquire_lock: single atomic UPSERT — succeeds only if no row exists yet
// or the existing lock has expired. This is race-safe because Postgres
// serializes the INSERT ... ON CONFLICT statement itself.
const sql = `
create or replace function try_acquire_lock(p_group_id text, p_ttl_seconds int)
returns boolean
language plpgsql
as $$
declare
  acquired boolean;
begin
  insert into assignment_locks (group_id, locked_until)
  values (p_group_id, now() + (p_ttl_seconds || ' seconds')::interval)
  on conflict (group_id) do update
    set locked_until = excluded.locked_until
    where assignment_locks.locked_until < now()
  returning true into acquired;
  return coalesce(acquired, false);
end;
$$;

create or replace function release_lock(p_group_id text)
returns void
language sql
as $$
  update assignment_locks set locked_until = now() where group_id = p_group_id;
$$;
`;

try {
  await client.connect();
  await client.query(sql);
  console.log("RPC functions created successfully.");
} catch (err) {
  console.error("Migration failed:", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
