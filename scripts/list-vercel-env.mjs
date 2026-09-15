import fs from "fs";

const envPath = new URL("../.env", import.meta.url);
const envText = fs.readFileSync(envPath, "utf8");
const get = (key) => {
  const m = envText.match(new RegExp(`^${key}\\s*=\\s*(.+)$`, "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
};

const token = get("VERCEL_ACCESS_TOKEN");
const PROJECT_ID = "prj_Myya52FuLycKrWiRrRBWRqdW2Q7Y";

const res = await fetch(`https://api.vercel.com/v9/projects/${PROJECT_ID}/env`, {
  headers: { Authorization: `Bearer ${token}` },
});
const body = await res.json();
for (const e of body.envs || []) {
  console.log(e.key, "->", e.target.join(","));
}
