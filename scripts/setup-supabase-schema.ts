// scripts/setup-supabase-schema.ts
// One-off / idempotent schema setup for the HR Dashboard's Supabase project.
// Run with: npx tsx scripts/setup-supabase-schema.ts
import "dotenv/config";
import { Client } from "pg";

const SQL = `
create extension if not exists pgcrypto;

create table if not exists user_metadata (
  id           uuid primary key default gen_random_uuid(),
  uipath_id    text unique not null,
  email        text,
  in_office    boolean not null default true,
  categories   text[] not null default '{}',
  updated_at   timestamptz not null default now(),
  updated_by   text
);
`;

async function main() {
  const password = process.env.SUPABASE_DB_PASSWORD;
  const projectRef = process.env.SUPABASE_PROJECT_REF;
  if (!password || !projectRef) {
    throw new Error("SUPABASE_DB_PASSWORD / SUPABASE_PROJECT_REF missing in .env");
  }

  const client = new Client({
    host: `db.${projectRef}.supabase.co`,
    port: 5432,
    user: "postgres",
    password,
    database: "postgres",
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    await client.query(SQL);
    console.log("user_metadata table ready.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
