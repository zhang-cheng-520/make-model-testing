// scripts/test-ca-webhook-filter.ts
//
// Offline tests for /api/ca-webhook-filter. global fetch is replaced by a stub, so no
// FileAI, UiPath or Vercel endpoint is ever called.   Run: npx tsx scripts/test-ca-webhook-filter.ts

import { Readable } from "stream";

process.env.CA_FILEAI_API_KEY = "test-key";
process.env.CA_FILEAI_BASE_URL = "https://fileai.test/prod/v1";
process.env.CA_MAESTRO_WEBHOOK_URL_TESTING = "https://uipath.test/webhooks/testing";
process.env.CA_WEBHOOK_FILTER_TOKEN_TESTING = "tok-testing";
delete process.env.CA_MAESTRO_WEBHOOK_URL_LIVE;
delete process.env.CA_WEBHOOK_FILTER_TOKEN_LIVE;

type Stub = {
  files?: any[] | "http500" | "timeout" | "nonjson";
  values?: any | "http500";
  forward?: number | "timeout";
};

const SUB = "6aaaaaaaaaaaaaaaaaaaaaaa";
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const valuesFor = (caseType: string) => ({
  formValues: [{ fields: [{ title: "priority", value: "P1" }, { title: "case_type", value: caseType }] }],
});
const emailBody = (m: number) => ({ fileId: "f-email", fileName: "email-body.pdf", fileClass: "email_body", createdAt: minutesAgo(m) });

let calls: string[] = [];
let forwardedBody: string | null = null;
let forwardedHeaders: Record<string, string> = {};

function installFetch(stub: Stub) {
  calls = [];
  forwardedBody = null;
  (globalThis as any).fetch = async (url: string, init: any = {}) => {
    calls.push(`${init.method || "GET"} ${url}`);
    const json = (status: number, body: unknown) =>
      new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
    if (url.startsWith("https://fileai.test/prod/v1/files?")) {
      if (stub.files === "timeout") throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
      if (stub.files === "http500") return json(500, { message: "boom" });
      if (stub.files === "nonjson") return json(200, "<html>");
      return json(200, { files: stub.files ?? [], count: (stub.files as any[] | undefined)?.length ?? 0 });
    }
    if (url.startsWith("https://fileai.test/prod/v1/files/")) {
      if (stub.values === "http500") return json(500, { message: "boom" });
      return json(200, stub.values ?? {});
    }
    if (url.startsWith("https://uipath.test/")) {
      forwardedBody = init.body;
      forwardedHeaders = init.headers;
      if (stub.forward === "timeout") throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
      return json(stub.forward ?? 202, "");
    }
    throw new Error(`unexpected fetch ${url}`);
  };
}

function makeReq(body: string, query: Record<string, string>, method = "POST") {
  const req: any = Readable.from([Buffer.from(body)]);
  req.method = method;
  req.query = query;
  req.headers = {
    "content-type": "application/json",
    "content-length": String(Buffer.byteLength(body)),
    "x-fileai-signature": "sig",
    "x-fileai-timestamp": "1760000000",
  };
  return req;
}

function makeRes() {
  const res: any = { statusCode: 0, payload: null };
  res.status = (c: number) => ((res.statusCode = c), res);
  res.json = (p: unknown) => ((res.payload = p), res);
  return res;
}

const webhook = (folderId: unknown = SUB, eventCode = "folder.processing.completed") =>
  JSON.stringify({ eventId: "evt-1", eventCode, data: { folderId, occurrenceId: "occ-1" } });

type Case = {
  name: string;
  body?: string;
  query?: Record<string, string>;
  stub?: Stub;
  status: number;
  verdict: string;
  reason: string;
  forwarded: boolean;
  fileaiCalls?: number;
};

const ok = { target: "testing", token: "tok-testing" };

const cases: Case[] = [
  { name: "1 fresh supported case type", stub: { files: [emailBody(2)], values: valuesFor("Motor - Renewal") }, status: 200, verdict: "VALID", reason: "FORWARDED", forwarded: true, fileaiCalls: 2 },
  { name: "2 earliest file 20 min old", stub: { files: [emailBody(20), { fileId: "f2", fileName: "a.pdf", createdAt: minutesAgo(5) }], values: valuesFor("Maid - Extension") }, status: 200, verdict: "VALID", reason: "FORWARDED", forwarded: true },
  { name: "3 earliest file 31 min old", stub: { files: [emailBody(31)], values: valuesFor("Motor - Renewal") }, status: 200, verdict: "INVALID", reason: "STALE_CASE", forwarded: false, fileaiCalls: 1 },
  { name: "4a Others case type", stub: { files: [emailBody(1)], values: valuesFor("Others") }, status: 200, verdict: "INVALID", reason: "CASE_TYPE_NOT_SUPPORTED", forwarded: false },
  { name: "4b wrong casing is not supported (exact match)", stub: { files: [emailBody(1)], values: valuesFor("motor - renewal") }, status: 200, verdict: "INVALID", reason: "CASE_TYPE_NOT_SUPPORTED", forwarded: false },
  { name: "4c empty case_type", stub: { files: [emailBody(1)], values: valuesFor("") }, status: 200, verdict: "INVALID", reason: "CASE_TYPE_MISSING", forwarded: false },
  { name: "5 missing email body", stub: { files: [{ fileId: "f2", fileName: "a.pdf", fileClass: "invoice", createdAt: minutesAgo(1) }] }, status: 200, verdict: "INVALID", reason: "NO_EMAIL_BODY", forwarded: false, fileaiCalls: 1 },
  { name: "5b email body via fileClass ^email_body", stub: { files: [{ fileId: "f9", fileName: "x.pdf", fileClass: "email_body_v2", createdAt: minutesAgo(1) }], values: valuesFor("Non Motor - Endorsement") }, status: 200, verdict: "VALID", reason: "FORWARDED", forwarded: true },
  { name: "6 top-level Case Type folder", body: webhook("6ac9c9fd5007c906eba0d4ea"), stub: {}, status: 200, verdict: "INVALID", reason: "TOP_LEVEL_CASE_TYPE_FOLDER", forwarded: false, fileaiCalls: 0 },
  { name: "no files in folder", stub: { files: [] }, status: 200, verdict: "INVALID", reason: "NO_FILES", forwarded: false },
  { name: "8a FileAI HTTP 500", stub: { files: "http500" }, status: 502, verdict: "ERROR", reason: "FILEAI_API_ERROR", forwarded: false, fileaiCalls: 1 },
  { name: "8b FileAI timeout", stub: { files: "timeout" }, status: 504, verdict: "ERROR", reason: "FILEAI_API_ERROR", forwarded: false, fileaiCalls: 1 },
  { name: "8c FileAI non-JSON", stub: { files: "nonjson" }, status: 502, verdict: "ERROR", reason: "FILEAI_API_ERROR", forwarded: false },
  { name: "8d FileAI values HTTP 500", stub: { files: [emailBody(1)], values: "http500" }, status: 502, verdict: "ERROR", reason: "FILEAI_API_ERROR", forwarded: false, fileaiCalls: 2 },
  { name: "9a UiPath webhook HTTP 500", stub: { files: [emailBody(1)], values: valuesFor("Motor - Renewal"), forward: 500 }, status: 502, verdict: "ERROR", reason: "MAESTRO_FORWARD_ERROR", forwarded: true },
  { name: "9b UiPath webhook timeout", stub: { files: [emailBody(1)], values: valuesFor("Motor - Renewal"), forward: "timeout" }, status: 504, verdict: "ERROR", reason: "MAESTRO_FORWARD_ERROR", forwarded: true },
  { name: "other eventCode ignored", body: webhook(SUB, "file.processing.completed"), stub: {}, status: 200, verdict: "IGNORED", reason: "INVALID_EVENT", forwarded: false, fileaiCalls: 0 },
  { name: "blank folderId", body: webhook("   "), stub: {}, status: 200, verdict: "INVALID", reason: "NO_FOLDER_ID", forwarded: false, fileaiCalls: 0 },
  { name: "non-string folderId", body: webhook(123), stub: {}, status: 200, verdict: "INVALID", reason: "NO_FOLDER_ID", forwarded: false },
  { name: "malformed JSON", body: "{oops", stub: {}, status: 400, verdict: "INVALID", reason: "INVALID_EVENT", forwarded: false },
  { name: "14a wrong token", query: { target: "testing", token: "nope" }, stub: {}, status: 401, verdict: "IGNORED", reason: "UNAUTHORIZED", forwarded: false, fileaiCalls: 0 },
  { name: "14b live target not configured", query: { target: "live", token: "tok-testing" }, stub: {}, status: 500, verdict: "ERROR", reason: "CONFIG_ERROR", forwarded: false, fileaiCalls: 0 },
  { name: "14c missing target", query: { token: "tok-testing" }, stub: {}, status: 400, verdict: "IGNORED", reason: "UNKNOWN_TARGET", forwarded: false },
];

async function main() {
  const { default: handler } = await import("../pages/api/ca-webhook-filter");
  let failed = 0;
  for (const c of cases) {
    installFetch(c.stub || {});
    const body = c.body ?? webhook();
    const res = makeRes();
    await handler(makeReq(body, c.query ?? ok), res);
    const fileaiCalls = calls.filter((u) => u.includes("fileai.test")).length;
    const forwarded = forwardedBody !== null;
    const problems: string[] = [];
    if (res.statusCode !== c.status) problems.push(`status ${res.statusCode} != ${c.status}`);
    if (res.payload?.verdict !== c.verdict) problems.push(`verdict ${res.payload?.verdict} != ${c.verdict}`);
    if (res.payload?.reason !== c.reason) problems.push(`reason ${res.payload?.reason} != ${c.reason}`);
    if (forwarded !== c.forwarded) problems.push(`forwarded ${forwarded} != ${c.forwarded}`);
    if (c.fileaiCalls !== undefined && fileaiCalls !== c.fileaiCalls) problems.push(`fileai calls ${fileaiCalls} != ${c.fileaiCalls}`);
    if (forwarded && forwardedBody !== body) problems.push("forwarded body differs from original");
    if (forwarded && forwardedHeaders["x-fileai-signature"] !== "sig") problems.push("FileAI signature header not passed through");
    if (calls.some((u) => /live/i.test(u))) problems.push("a Live URL was called");
    if (calls.filter((u) => u.includes("uipath.test")).length > 1) problems.push("forward retried");
    console.log(`${problems.length ? "FAIL" : "PASS"}  ${c.name}  -> ${res.statusCode} ${res.payload?.verdict}/${res.payload?.reason}${problems.length ? "  :: " + problems.join("; ") : ""}`);
    if (problems.length) failed++;
  }
  console.log(`\n${cases.length - failed}/${cases.length} passed`);
  process.exitCode = failed ? 1 : 0;
}

main();
