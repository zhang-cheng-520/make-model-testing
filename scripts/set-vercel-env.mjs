import fs from "fs";

const envPath = new URL("../.env", import.meta.url);
const envText = fs.readFileSync(envPath, "utf8");
const get = (key) => {
  const m = envText.match(new RegExp(`^${key}\\s*=\\s*(.+)$`, "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
};

const token = get("VERCEL_ACCESS_TOKEN");
const teamId = get("VERCEL_TEAM_ID");

const KEY = process.argv[2];
const VALUE = process.argv[3];
if (!KEY || !VALUE) {
  console.error("Usage: node scripts/set-vercel-env.mjs <KEY> <VALUE>");
  process.exit(1);
}

async function vercelFetch(path, opts = {}) {
  const url = `https://api.vercel.com${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(body)}`);
  return body;
}

async function main() {
  const projects = await vercelFetch(`/v9/projects?search=make-model`);
  const project = projects.projects?.[0];
  if (!project) throw new Error("No matching Vercel project found for 'make-model'");
  console.log(`Project: ${project.name} (${project.id})`);

  const envList = await vercelFetch(`/v9/projects/${project.id}/env`);
  const existing = (envList.envs || []).find((e) => e.key === KEY && e.target.includes("production"));

  if (existing) {
    await vercelFetch(`/v9/projects/${project.id}/env/${existing.id}`, {
      method: "PATCH",
      body: JSON.stringify({ value: VALUE }),
    });
    console.log(`Updated ${KEY} (production) -> ${VALUE}`);
  } else {
    await vercelFetch(`/v10/projects/${project.id}/env`, {
      method: "POST",
      body: JSON.stringify({ key: KEY, value: VALUE, type: "encrypted", target: ["production", "preview", "development"] }),
    });
    console.log(`Created ${KEY} -> ${VALUE}`);
  }
}

main().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
