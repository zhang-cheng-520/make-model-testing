// pages/api/ca-webhook-filter.ts
//
// Pre-Maestro filter for FileAI "folder.processing.completed" webhooks. Runs the case
// validation that used to live in the BPMN (Get Basic Info + Is Valid Case?) and forwards
// ONLY valid cases, byte-for-byte, to the UiPath HTTP Webhook event trigger.
//
// Contract:
//   POST /api/ca-webhook-filter?target=testing|live&token=<per-target token>
//   body: FileAI webhook { eventId, eventCode, data: { folderId, occurrenceId } }
//   -> 200 VALID (forwarded) | INVALID | IGNORED
//   -> 4xx bad request / unauthorized, 5xx ERROR (FileAI or forward failure, never retried)
//
// One structured log line per request: "[ca-webhook-filter] {...}". No retries, no storage.

import type { NextApiRequest, NextApiResponse } from "next";
import { timingSafeEqual } from "crypto";
import getRawBody from "raw-body";
import {
  EXPECTED_EVENT_CODE,
  FRESHNESS_LIMIT_MS,
  TOP_LEVEL_CASE_TYPE_FOLDERS,
  ageMs,
  earliestCreatedAt,
  extractField,
  extractFolderId,
  isSupportedCaseType,
  pickEmailBodyFile,
  type FileAiFile,
} from "../../lib/caseFilter";

export const config = {
  api: { bodyParser: false }, // the original bytes are forwarded unchanged
  maxDuration: 60,
};

const CA_FILEAI_BASE_URL = (process.env.CA_FILEAI_BASE_URL || "https://api.orion.sg.file.ai/prod/v1").replace(/\/+$/, "");
const CA_FILEAI_API_KEY = process.env.CA_FILEAI_API_KEY || "";

// Each target has its own destination and its own inbound token, so a Testing caller can never reach Live.
const TARGETS: Record<string, { url: string; token: string }> = {
  testing: {
    url: process.env.CA_MAESTRO_WEBHOOK_URL_TESTING || "",
    token: process.env.CA_WEBHOOK_FILTER_TOKEN_TESTING || "",
  },
  live: {
    url: process.env.CA_MAESTRO_WEBHOOK_URL_LIVE || "",
    token: process.env.CA_WEBHOOK_FILTER_TOKEN_LIVE || "",
  },
};

const FILEAI_TIMEOUT_MS = 10_000;
const FORWARD_TIMEOUT_MS = 15_000;
// FileAI headers passed through so the trigger sees the same delivery it gets today.
const FORWARDED_HEADERS = ["x-fileai-timestamp", "x-fileai-signature", "x-fileai-signature-version", "x-correlation-id"];

type Verdict = "VALID" | "INVALID" | "ERROR" | "IGNORED";

type LogRecord = {
  timestamp: string;
  target: string | null;
  eventId: string | null;
  eventCode: string | null;
  subfolderId: string | null;
  caseType: string | null;
  earliestFileCreatedAt: string | null;
  fileAgeMinutes: number | null;
  verdict?: Verdict;
  reason?: string;
  detail?: string;
  folderMismatch: string;
  forward: string;
  durationMs?: number;
};

class FileAiError extends Error {
  constructor(message: string, public timedOut = false) {
    super(message);
  }
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function firstQuery(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

async function fileaiGet(pathQs: string): Promise<any> {
  let res: Response;
  try {
    res = await fetch(`${CA_FILEAI_BASE_URL}/${pathQs}`, {
      headers: { "x-api-key": CA_FILEAI_API_KEY, Accept: "application/json" },
      signal: AbortSignal.timeout(FILEAI_TIMEOUT_MS),
    });
  } catch (err: any) {
    const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
    throw new FileAiError(timedOut ? `timeout after ${FILEAI_TIMEOUT_MS}ms` : `network: ${err?.message || err}`, timedOut);
  }
  const text = await res.text();
  if (!res.ok) throw new FileAiError(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new FileAiError(`HTTP ${res.status}: non-JSON response`);
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const started = Date.now();
  const log: LogRecord = {
    timestamp: new Date(started).toISOString(),
    target: null,
    eventId: null,
    eventCode: null,
    subfolderId: null,
    caseType: null,
    earliestFileCreatedAt: null,
    fileAgeMinutes: null,
    folderMismatch: "not_checked", // the webhook carries no parent-folder metadata
    forward: "not_attempted",
  };

  const finish = (status: number, verdict: Verdict, reason: string, detail?: string) => {
    log.verdict = verdict;
    log.reason = reason;
    if (detail) log.detail = detail;
    log.durationMs = Date.now() - started;
    const line = `[ca-webhook-filter] ${JSON.stringify(log)}`;
    if (verdict === "ERROR") console.error(line);
    else console.log(line);
    return res.status(status).json({ verdict, reason });
  };

  if (req.method !== "POST") return finish(405, "IGNORED", "METHOD_NOT_ALLOWED");

  const targetName = firstQuery(req.query.target) || "";
  const target = TARGETS[targetName];
  log.target = targetName || null;
  if (!target) return finish(400, "IGNORED", "UNKNOWN_TARGET");
  if (!target.token || !target.url) return finish(500, "ERROR", "CONFIG_ERROR", `target '${targetName}' is not configured`);
  if (TARGETS.testing.url && TARGETS.testing.url === TARGETS.live.url) {
    return finish(500, "ERROR", "CONFIG_ERROR", "testing and live destinations are identical");
  }
  const token = firstQuery(req.query.token) || String(req.headers["x-ca-filter-token"] || "");
  if (!safeEqual(token, target.token)) return finish(401, "IGNORED", "UNAUTHORIZED");
  if (!CA_FILEAI_API_KEY) return finish(500, "ERROR", "CONFIG_ERROR", "CA_FILEAI_API_KEY is not configured");

  let raw: string;
  let payload: any;
  try {
    raw = (await getRawBody(req, { encoding: "utf-8", limit: "1mb" })) as string;
    payload = JSON.parse(raw);
  } catch (err: any) {
    return finish(400, "INVALID", "INVALID_EVENT", `unreadable body: ${err?.message || err}`);
  }

  log.eventId = typeof payload?.eventId === "string" ? payload.eventId : null;
  log.eventCode = typeof payload?.eventCode === "string" ? payload.eventCode : null;
  if (log.eventCode !== EXPECTED_EVENT_CODE) return finish(200, "IGNORED", "INVALID_EVENT");

  const subfolderId = extractFolderId(payload);
  log.subfolderId = subfolderId || null;
  if (!subfolderId) return finish(200, "INVALID", "NO_FOLDER_ID");
  if (TOP_LEVEL_CASE_TYPE_FOLDERS[subfolderId]) {
    return finish(200, "INVALID", "TOP_LEVEL_CASE_TYPE_FOLDER", TOP_LEVEL_CASE_TYPE_FOLDERS[subfolderId]);
  }

  // Get Basic Info, step 1: file list -> earliest createdAt (checked first to skip the 2nd call on stale folders).
  let files: FileAiFile[];
  try {
    const body = await fileaiGet(`files?directoryId=${encodeURIComponent(subfolderId)}&limit=200`);
    if (!Array.isArray(body?.files)) throw new FileAiError("files response has no 'files' array");
    files = body.files;
  } catch (err: any) {
    return finish(err?.timedOut ? 504 : 502, "ERROR", "FILEAI_API_ERROR", `files list: ${err?.message || err}`);
  }

  const earliest = earliestCreatedAt(files);
  log.earliestFileCreatedAt = earliest;
  if (!earliest) return finish(200, "INVALID", "NO_FILES");
  const age = ageMs(earliest, Date.now());
  log.fileAgeMinutes = Number.isFinite(age) ? Math.round((age / 60_000) * 10) / 10 : null;
  if (!(age <= FRESHNESS_LIMIT_MS)) {
    return finish(200, "INVALID", "STALE_CASE", Number.isFinite(age) ? undefined : "unparseable createdAt");
  }

  // Get Basic Info, step 2: Email Body extracted values -> case_type (authoritative).
  const emailBody = pickEmailBodyFile(files);
  if (!emailBody?.fileId) return finish(200, "INVALID", "NO_EMAIL_BODY");
  let values: unknown;
  try {
    values = await fileaiGet(`files/${encodeURIComponent(emailBody.fileId)}/values`);
  } catch (err: any) {
    return finish(err?.timedOut ? 504 : 502, "ERROR", "FILEAI_API_ERROR", `email body values: ${err?.message || err}`);
  }

  const caseType = String(extractField(values, "case_type"));
  log.caseType = caseType ? caseType.slice(0, 80) : null;
  if (!caseType) return finish(200, "INVALID", "CASE_TYPE_MISSING");
  if (!isSupportedCaseType(caseType)) return finish(200, "INVALID", "CASE_TYPE_NOT_SUPPORTED");

  // VALID: forward the original body and FileAI headers. No retry; a timeout may still have been delivered.
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  for (const name of FORWARDED_HEADERS) {
    const value = req.headers[name];
    if (typeof value === "string") headers[name] = value;
  }
  try {
    const fwd = await fetch(target.url, {
      method: "POST",
      headers,
      body: raw,
      signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
    });
    log.forward = `http_${fwd.status}`;
    if (!fwd.ok) {
      const text = await fwd.text().catch(() => "");
      return finish(502, "ERROR", "MAESTRO_FORWARD_ERROR", `HTTP ${fwd.status}: ${text.slice(0, 200)}`);
    }
  } catch (err: any) {
    const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
    log.forward = timedOut ? "timeout_delivery_unknown" : "network_error";
    return finish(timedOut ? 504 : 502, "ERROR", "MAESTRO_FORWARD_ERROR", String(err?.message || err));
  }

  return finish(200, "VALID", "FORWARDED");
}
