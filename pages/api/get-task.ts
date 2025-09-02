import type { NextApiRequest, NextApiResponse } from "next";
import OpenAI from "openai";
import { z } from "zod";


/**
 * ENV REQUIRED:
 *  OPENAI_API_KEY=<openai project key>
 *  UIPATH_TOKEN=<uipath bearer token>
 *  GROUP_ID_CLAIMS=<guid>
 *  GROUP_ID_MARKETING=<guid>
 *  GROUP_ID_TECH=<guid>
 *  GROUP_ID_CS=<guid>           # Customer Support
 *  GROUP_ID_BIZSUPPORT=<guid>   # Business Support
 */

const TOKEN = process.env.UIPATH_TOKEN || "";

// Tenant/account constants (yours)
const ACCOUNT = "ecicsxdqonrj";
const TENANT = "DefaultTenant";

// Identity (org)
const ORG_ID = "1efb5f86-17ed-44d3-b3f5-b29b68502dea";

// Orchestrator folder (Ecics)
const FOLDER_ID = 847179;

// ------------ OpenAI classifier (few-shot + structured outputs via Zod) ------------
const OPENAI_KEY = process.env.OPENAI_API_KEY || "";
const PROMPT_ID = process.env.EMAIL_CLASSIFIER_PROMPT_ID;
// const PROMPT_VERSION = process.env.EMAIL_CLASSIFIER_PROMPT_VERSION || "1";

if (!OPENAI_KEY) throw new Error("OPENAI_API_KEY missing");
if (!PROMPT_ID) throw new Error("EMAIL_CLASSIFIER_PROMPT_ID missing");

const client = new OpenAI({ apiKey: OPENAI_KEY });

type Label =
  | "Claims"
  | "Marketing"
  | "Tech"
  | "CustomerSupport"
  | "BusinessSupport"
  | "Other";

// Zod schema to validate the model output
const EmailRoute = z.object({
  label: z.enum([
    "Claims",
    "Marketing",
    "Tech",
    "CustomerSupport",
    "BusinessSupport",
    "Other",
  ]),
  confidence: z.number().min(0).max(1),
  rationale: z.string().max(220),
});
type EmailRouteT = z.infer<typeof EmailRoute>;

function quickRedact(s: string) {
  return String(s)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "<PII:EMAIL>")
    .replace(/(\+?\d[\d\s\-().]{7,}\d)/g, "<PII:PHONE>")
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, "<PII:CARD>");
}

export async function classifyLabel(raw: string): Promise<EmailRouteT> {
  const masked = quickRedact((raw ?? "").trim());
  if (!masked) return { label: "Other", confidence: 0, rationale: "Empty input." };

  const resp = await client.responses.create({
    model: "gpt-5-mini",  // do NOT send temperature/top_p
    prompt: {
      id: PROMPT_ID,
    //   version: PROMPT_VERSION,
      variables: { email_text: masked }, // must match a declared variable in the prompt
    },
    text: {
      format: {
        type: "json_schema",
        name: "EmailRoute",
        strict: true,
        schema: {
          type: "object",
          required: ["label", "confidence", "rationale"],
          properties: {
            label: { type: "string", enum: ["Claims","Marketing","Tech","CustomerSupport","BusinessSupport","Other"] },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            rationale: { type: "string", maxLength: 220 },
          },
          additionalProperties: false,
        },
      },
    },
  });

  const rawJson = resp.output_text ?? "{}";
  try {
    return EmailRoute.parse(JSON.parse(rawJson));
  } catch {
    throw new Error(`Structured output invalid: ${rawJson}`);
  }
}


// ------------ UiPath helpers (your original logic, generalized) ------------

async function uiGet<T>(url: string): Promise<T> {
  if (!TOKEN) throw new Error("UIPATH_TOKEN is missing");
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText} for ${url}\n${body}`);
  }
  return res.json();
}

// Compute today's start/end UTC boundaries for the Singapore (UTC+08:00) day
function getTodaySgtUtcWindow() {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [{ value: y }, , { value: m }, , { value: d }] = fmt.formatToParts(now);
  const sgtMidnight = new Date(`${y}-${m}-${d}T00:00:00+08:00`);
  const startUtcIso = sgtMidnight.toISOString();
  const endUtcIso = new Date(sgtMidnight.getTime() + 24 * 60 * 60 * 1000).toISOString();
  return { startUtc: startUtcIso, endUtc: endUtcIso };
}

type IdentityMember = { identifier: string; email?: string; displayName?: string; };

async function getGroupMembers(groupId: string): Promise<IdentityMember[]> {
  const url = `https://cloud.uipath.com/${ACCOUNT}/identity_/api/Group/${ORG_ID}/${groupId}`;
  const data = await uiGet<{ members?: any[] }>(url);
  const raw = data.members || [];
  return raw
    .filter((m) => m.objectType === "DirectoryUser")
    .map((m) => ({
      identifier: m.identifier,
      email: (m.email || m.name || "").toLowerCase() || undefined,
      displayName: m.displayName || m.name || m.email || undefined,
    }));
}

type OrchestratorUser = { Id: number; EmailAddress?: string; UserName?: string; Key: string; Type?: string; };

async function getAllUsers(): Promise<OrchestratorUser[]> {
  const url = `https://cloud.uipath.com/${ACCOUNT}/${TENANT}/orchestrator_/odata/Users?$top=100&$select=Id,EmailAddress,UserName,Key,Type`;
  const data = await uiGet<{ value: OrchestratorUser[] }>(url);
  return data.value || [];
}

type TaskItem = {
  Id: number;
  AssignedToUserId: number | null;
  Status: string;
  IsCompleted: boolean;
  CreationTime: string;
  OrganizationUnitId: number;
};

async function getOpenTasksInEcicsToday(): Promise<TaskItem[]> {
  const base = `https://cloud.uipath.com/${ACCOUNT}/${TENANT}/orchestrator_/odata/Tasks/UiPath.Server.Configuration.OData.GetTasksAcrossFoldersForAdmin`;
  const select = "Id,Status,IsCompleted,CreationTime,AssignedToUserId,OrganizationUnitId";
  const { startUtc, endUtc } = getTodaySgtUtcWindow();
  const filter =
    `OrganizationUnitId eq ${FOLDER_ID} and IsCompleted eq false` +
    ` and CreationTime ge ${startUtc} and CreationTime lt ${endUtc}`;
  const url = `${base}?$top=1000&$count=true&$select=${encodeURIComponent(select)}&$filter=${encodeURIComponent(filter)}`;
  const data = await uiGet<{ value: TaskItem[] }>(url);
  return data.value || [];
}

function alphaName(a: string, b: string) {
  return a.localeCompare(b, "en", { sensitivity: "base" });
}

function pickLeastLoaded(
  candidates: { email: string; userId: number; name: string }[],
  tasks: TaskItem[],
  mode: "strict-wip" | "balanced" = "balanced"
) {
  const byUser: Record<number, TaskItem[]> = {};
  for (const t of tasks) {
    if (t.AssignedToUserId == null) continue;
    (byUser[t.AssignedToUserId] ||= []).push(t);
  }
  const scored = candidates.map((c) => {
    const mine = byUser[c.userId] || [];
       const inProgress = mine.filter((t) => t.Status === "InProgress").length;
    const totalAssignedOpen = mine.length;
    return { ...c, inProgress, totalAssignedOpen };
  });

  if (mode === "strict-wip") {
    scored.sort(
      (a, b) => a.inProgress - b.inProgress || alphaName(a.name || a.email, b.name || b.email)
    );
  } else {
    scored.sort(
      (a, b) =>
        a.inProgress - b.inProgress ||
        a.totalAssignedOpen - b.totalAssignedOpen ||
        alphaName(a.name || a.email, b.name || b.email)
    );
  }

  const selected = scored[0] || null;
  return { selected, tallies: scored };
}

// ------------ Label → Group mapping ------------

const GROUPS: Record<Exclude<Label, "Other">, string> = {
  Claims: process.env.GROUP_ID_CLAIMS || "",
  Marketing: process.env.GROUP_ID_MARKETING || "",
  Tech: process.env.GROUP_ID_TECH || "809f993a-8a1b-4805-ba8f-8a013720dd7e",
  CustomerSupport: process.env.GROUP_ID_CS || "",
  BusinessSupport: process.env.GROUP_ID_BIZSUPPORT || "4225e926-5732-44b0-9021-055cc3452241"
};

// ------------ API handler ------------

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
    if (!OPENAI_KEY) return res.status(400).json({ error: "OPENAI_API_KEY missing" });
    if (!TOKEN) return res.status(400).json({ error: "UIPATH_TOKEN missing" });

    const { emailText, mode: modeParam, overrideLabel } = (req.body || {}) as {
      emailText?: string;
      mode?: "strict-wip" | "balanced";
      overrideLabel?: Label; // allow manual override for testing
    };

    if (!emailText && !overrideLabel) {
      return res.status(400).json({ error: "Provide emailText or overrideLabel" });
    }

    const mode: "strict-wip" | "balanced" = modeParam === "strict-wip" ? "strict-wip" : "balanced";

    // 0) classify (or honor explicit override)
    let label: Label = overrideLabel || "Other";
    let confidence = 0;
    let rationale = "";

    if (!overrideLabel && emailText) {
      const out = await classifyLabel(emailText);
      label = out.label;
      confidence = out.confidence;
      rationale = out.rationale;
    }

    // 1) find target group
    const targetGroupId =
      label !== "Other" ? GROUPS[label] : (process.env.GROUP_ID_BIZSUPPORT || ""); // fallback

    if (!targetGroupId) {
      return res.status(500).json({ error: `No GROUP_ID configured for label ${label}` });
    }

    // 2) eligible users in that group
    const members = await getGroupMembers(targetGroupId);

    // 3) map to Orchestrator users
    const allUsers = await getAllUsers();
    const userByKey = new Map(
      allUsers.filter((u) => u.Type === "DirectoryUser").map((u) => [u.Key.toLowerCase(), u])
    );
    const candidates = members
      .map((m) => {
        const u = userByKey.get(m.identifier.toLowerCase());
        return {
          email: (m.email || u?.EmailAddress || u?.UserName || "").toLowerCase(),
          name: m.displayName || u?.UserName || u?.EmailAddress || "",
          userId: u?.Id as number | undefined
        };
      })
      .filter((c) => typeof c.userId === "number" && c.email) as {
        email: string; name: string; userId: number;
      }[];

    // 4) today’s open tasks in Ecics (SGT day)
    const tasks = await getOpenTasksInEcicsToday();

    // 5) pick least-loaded and return
    const { selected, tallies } = pickLeastLoaded(candidates, tasks, mode);

    return res.status(200).json({
      assigneeEmail: selected?.email || null,
      label,
      confidence,
      rationale,
      // --- uncomment to debug
      // selected: selected ? {
      //   email: selected.email,
      //   userId: selected.userId,
      //   name: selected.name,
      //   workload: { inProgress: selected.inProgress, openAssigned: selected.totalAssignedOpen }
      // } : null,
      // tallies: tallies.map(t => ({
      //   email: t.email, userId: t.userId, name: t.name,
      //   workload: { inProgress: t.inProgress, openAssigned: t.totalAssignedOpen }
      // })),
      // basis: { folderId: FOLDER_ID, policy: mode, totals: { openTasksToday: tasks.length, groupSize: candidates.length } }
    });
  } catch (err: any) {
    console.error("assign error:", err?.message || err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
