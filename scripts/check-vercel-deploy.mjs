import fs from "fs";

const envPath = new URL("../.env", import.meta.url);
const envText = fs.readFileSync(envPath, "utf8");
const get = (key) => {
  const m = envText.match(new RegExp(`^${key}\\s*=\\s*(.+)$`, "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
};

const token = get("VERCEL_ACCESS_TOKEN");

const res = await fetch(
  "https://api.vercel.com/v6/deployments?projectId=prj_Myya52FuLycKrWiRrRBWRqdW2Q7Y&limit=3",
  { headers: { Authorization: `Bearer ${token}` } }
);
const body = await res.json();
for (const d of body.deployments || []) {
  console.log(d.state, d.readyState, new Date(d.created).toISOString(), d.meta?.githubCommitSha || "", d.url);
}
