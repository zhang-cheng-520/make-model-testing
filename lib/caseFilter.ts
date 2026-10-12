// lib/caseFilter.ts
//
// Case-validation rules moved out of the Maestro "Get Basic Info" subprocess and
// "Is Valid Case?" gateway (release_final v1.0.2). Every extractor below mirrors the
// deployed BPMN expression it replaces, so Vercel and Maestro read FileAI the same way.
// Only the freshness limit differs: 30 minutes (was 15 in the BPMN gateway).

export const EXPECTED_EVENT_CODE = "folder.processing.completed";

export const FRESHNESS_LIMIT_MS = 30 * 60 * 1000;

// Exact, case-sensitive strings from the BPMN "Is Valid Case?" allowlist.
export const SUPPORTED_CASE_TYPES: readonly string[] = [
  "Motor - New Business",
  "Motor - Renewal",
  "Motor - Cancellation",
  "Motor - Endorsement",
  "Motor - Extension",
  "Non Motor - New Business",
  "Non Motor - Renewal",
  "Non Motor - Cancellation",
  "Non Motor - Endorsement",
  "Non Motor - Extension",
  "Maid - New Business",
  "Maid - Renewal",
  "Maid - Cancellation",
  "Maid - Endorsement",
  "Maid - Extension",
];

// FileAI top-level Case Type folders (directoryId -> folder name). Verified 2026-10-12 as the
// breadcrumbs[0] parent of thousands of depth-1 case folders. Webhooks fired for these folders
// are never cases. "Maid - Extension" had no folder in FileAI yet; a new top-level folder that is
// missing here still fails the freshness rule because it holds old files.
export const TOP_LEVEL_CASE_TYPE_FOLDERS: Readonly<Record<string, string>> = {
  "6ac9c9fd5007c906eba0d4ea": "Motor - New Business",
  "6ac9c9cb18e79b706348aed5": "Motor - Renewal",
  "6ac9c9dd4740778cbc6b5bfe": "Motor - Cancellation",
  "6ac9c9cc18e79b706348aed7": "Motor - Endorsement",
  "6ac9ca2e3f13ff43cdf50f92": "Motor - Extension",
  "6ac9ccd808e080cfa4a0dbf7": "Non Motor - New Business",
  "6ac9ca2d3f13ff43cdf50f8e": "Non Motor - Renewal",
  "6aca0b0e343a8d51e4701b89": "Non Motor - Cancellation",
  "6ac9ca2115a472544226f576": "Non Motor - Endorsement",
  "6aca684c343a8d51e470b4cb": "Non Motor - Extension",
  "6ac9cab018e79b706348af7c": "Maid - New Business",
  "6ac9d0e0b4440c4b5fcf803d": "Maid - Renewal",
  "6ac9cf0c9d319ba0367433be": "Maid - Cancellation",
  "6ac9ca15343a8d51e46fba6d": "Maid - Endorsement",
  "6ac9c9cb18e79b706348aed3": "Others",
};

export type FileAiFile = {
  fileId?: string;
  fileName?: string;
  fileClass?: string;
  createdAt?: string;
};

// BPMN "Extract Webhook Folder ID": data.folderId only when it is a string, trimmed.
export function extractFolderId(payload: unknown): string {
  const data = (payload as { data?: { folderId?: unknown } } | null)?.data;
  return data && typeof data.folderId === "string" ? data.folderId.trim() : "";
}

// BPMN earliest_file_created_at: files.map(createdAt).filter(Boolean).sort()[0] || null
export function earliestCreatedAt(files: FileAiFile[]): string | null {
  return files.map((f) => f && f.createdAt).filter(Boolean).sort()[0] || null;
}

// BPMN "Get extracted values" file pick: email-body.pdf, else first fileClass matching ^email_body.
export function pickEmailBodyFile(files: FileAiFile[]): FileAiFile | null {
  return (
    files.find((f) => f && f.fileName === "email-body.pdf") ||
    files.find((f) => f && /^email_body/.test(f.fileClass || "")) ||
    null
  );
}

// BPMN case_type / priority: first formValues[].fields[] entry with the title and a non-empty value.
export function extractField(valuesBody: unknown, title: string): string {
  const formValues = (valuesBody as { formValues?: Array<{ fields?: any[] }> } | null)?.formValues || [];
  const field = formValues
    .flatMap((fv) => (fv && fv.fields) || [])
    .find((f) => f && f.title === title && f.value !== null && f.value !== undefined && f.value !== "");
  return field ? field.value : "";
}

export function isSupportedCaseType(caseType: string): boolean {
  return SUPPORTED_CASE_TYPES.includes(caseType);
}

// Age of the earliest file at validation time; NaN when the timestamp is unparseable.
export function ageMs(earliest: string, nowMs: number): number {
  return nowMs - new Date(earliest).getTime();
}
