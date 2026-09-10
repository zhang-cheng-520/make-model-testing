import { useEffect, useState } from "react";
import { DashboardLayout } from "../../components/dashboard-layout";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { ToastStack, type ToastKind } from "../../components/ui/toast";

type QueueResult = {
  policyNumber: string;
  success: boolean;
  id?: number;
  key?: string;
  error?: string;
};

let nextToastId = 1;

// Session-only persistence: survives reloads/navigation within the same tab
// (unlike plain component state), but is explicitly cleared on sign-out (see
// dashboard-layout.tsx) and disappears entirely once the browser tab closes —
// never written to anything longer-lived than that.
const RESULTS_CACHE_KEY = "trpa-results";

function loadCachedResults(): QueueResult[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(RESULTS_CACHE_KEY);
    return raw ? (JSON.parse(raw) as QueueResult[]) : [];
  } catch {
    return [];
  }
}

export default function TrpaPage() {
  const [policyText, setPolicyText] = useState("");
  const [status, setStatus] = useState("PROD M01 Release");
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<QueueResult[]>([]);
  const [toasts, setToasts] = useState<{ id: number; message: string; kind: ToastKind }[]>([]);

  // Hydrate from sessionStorage after mount rather than during the initial
  // render — reading it eagerly (e.g. as the useState initializer) would
  // make the client's first render disagree with the server-rendered HTML
  // (which always starts empty) and trigger a hydration mismatch.
  useEffect(() => {
    setResults(loadCachedResults());
  }, []);

  useEffect(() => {
    window.sessionStorage.setItem(RESULTS_CACHE_KEY, JSON.stringify(results));
  }, [results]);

  function pushToast(message: string, kind: ToastKind) {
    const id = nextToastId++;
    setToasts((prev) => [...prev, { id, message, kind }]);
  }

  function dismissToast(id: number) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  const policyNumbers = policyText
    .split(/\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  async function submit() {
    if (policyNumbers.length === 0) {
      pushToast("Enter at least one policy number.", "error");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/dashboard/trpa-queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ policyNumbers, status }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      const newResults: QueueResult[] = data.results;
      setResults(newResults);

      const succeeded = newResults.filter((r) => r.success).length;
      const failed = newResults.length - succeeded;
      if (failed === 0) {
        pushToast(`Added ${succeeded} item${succeeded === 1 ? "" : "s"} to the TRPA queue.`, "success");
      } else if (succeeded === 0) {
        pushToast(`Failed to add ${failed} item${failed === 1 ? "" : "s"} — see the table below.`, "error");
      } else {
        pushToast(`Added ${succeeded}, failed ${failed} — see the table below.`, "info");
      }
      setPolicyText("");
    } catch (err: any) {
      pushToast(err?.message || "Failed to add items to the queue.", "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <DashboardLayout>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">TRPA - Release+DebitNote</h1>
        <p className="text-sm text-muted-foreground">
          Paste one policy number per line, then add them to the TRPA Orchestrator queue.
        </p>
      </div>

      <div className="mb-4 grid max-w-lg gap-4">
        <label className="grid gap-1.5">
          <span className="text-sm font-medium">Policy numbers (one per line)</span>
          <textarea
            className="min-h-[160px] rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring font-mono"
            placeholder={"MPC26P00743700\nMPC26P00754200\nMPC26P00755400"}
            value={policyText}
            onChange={(e) => setPolicyText(e.target.value)}
            disabled={submitting}
          />
          <span className="text-xs text-muted-foreground">
            {policyNumbers.length} polic{policyNumbers.length === 1 ? "y" : "ies"} detected
          </span>
        </label>

        <label className="grid gap-1.5">
          <span className="text-sm font-medium">Status</span>
          <Input value={status} onChange={(e) => setStatus(e.target.value)} disabled={submitting} />
        </label>

        <Button onClick={submit} disabled={submitting || policyNumbers.length === 0}>
          {submitting ? "Adding to queue..." : "Add to queue"}
        </Button>
      </div>

      {results.length > 0 && (
        <div className="mt-8 rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Policy number</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Queue item</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.map((r) => {
                const detail = r.success ? `#${r.id}` : r.error;
                return (
                  <TableRow key={r.policyNumber}>
                    <TableCell className="font-medium">{r.policyNumber}</TableCell>
                    <TableCell>
                      {r.success ? (
                        <span className="inline-flex items-center gap-1.5 text-green-700">
                          <span className="h-1.5 w-1.5 rounded-full bg-green-600" />
                          Added
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-destructive">
                          <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
                          Failed
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{detail}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </DashboardLayout>
  );
}
