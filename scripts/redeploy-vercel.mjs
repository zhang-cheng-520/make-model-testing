import fs from "fs";

const envPath = new URL("../.env", import.meta.url);
const envText = fs.readFileSync(envPath, "utf8");
const get = (key) => {
  const m = envText.match(new RegExp(`^${key}\\s*=\\s*(.+)$`, "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
};

const token = get("VERCEL_ACCESS_TOKEN");
const PROJECT_ID = "prj_Myya52FuLycKrWiRrRBWRqdW2Q7Y";

async function vercelFetch(path, opts = {}) {
  const res = await fetch(`https://api.vercel.com${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(body)}`);
  return body;
}

async function main() {
  const list = await vercelFetch(`/v6/deployments?projectId=${PROJECT_ID}&limit=1&target=production`);
  const latest = list.deployments?.[0];
  if (!latest) throw new Error("No production deployment found to redeploy from");
  console.log(`Redeploying from ${latest.uid} (${latest.meta?.githubCommitSha || "no sha"})`);

  const created = await vercelFetch(`/v13/deployments?forceNew=1`, {
    method: "POST",
    body: JSON.stringify({
      name: latest.name,
      project: PROJECT_ID,
      target: "production",
      deploymentId: latest.uid,
      meta: { action: "redeploy" },
    }),
  });
  console.log(`New deployment: ${created.id} -> ${created.url}`);
}

main().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
