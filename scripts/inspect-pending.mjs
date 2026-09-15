import fs from "fs";
import pg from "pg";

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
await client.connect();
const res = await client.query(
  `select id, group_id, user_id, email, reserved_at, now() - reserved_at as age
   from pending_assignments
   order by reserved_at desc`
);
console.table(res.rows);
await client.end();
