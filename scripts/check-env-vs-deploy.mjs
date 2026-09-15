import fs from "fs";

const envPath = new URL("../.env", import.meta.url);
const envText = fs.readFileSync(envPath, "utf8");
const get = (key) => {
  const m = envText.match(new RegExp(`^${key}\\s*=\\s*(.+)$`, "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
};

const token = get("VERCEL_ACCESS_TOKEN");
const PROJECT_ID = "prj_Myya52FuLycKrWiRrRBWRqdW2Q7Y";

const envRes = await fetch(`https://api.vercel.com/v9/projects/${PROJECT_ID}/env`, {
  headers: { Authorization: `Bearer ${token}` },
});
const envBody = await envRes.json();
const target = ["TRPA_FOLDER_ID", "CA_ORCHESTRATOR_PAT", "CA_ORG", "CA_TENANT"];
for (const e of envBody.envs || []) {
  if (target.includes(e.key)) {
    console.log(e.key, "createdAt:", new Date(e.createdAt).toISOString(), "updatedAt:", new Date(e.updatedAt || e.createdAt).toISOString());
  }
}

const depRes = await fetch(
  `https://api.vercel.com/v6/deployments?projectId=${PROJECT_ID}&limit=1&target=production`,
  { headers: { Authorization: `Bearer ${token}` } }
);
const depBody = await depRes.json();
const latest = depBody.deployments?.[0];
console.log("Latest production deployment:", latest?.uid, new Date(latest?.created).toISOString(), latest?.meta?.githubCommitSha);
