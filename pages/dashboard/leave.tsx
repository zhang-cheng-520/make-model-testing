import { useEffect, useState } from "react";
import { DashboardLayout } from "../../components/dashboard-layout";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { ToastStack, type ToastKind } from "../../components/ui/toast";
import { InfoTooltip } from "../../components/info-tooltip";
import { TooltipProvider } from "../../components/ui/tooltip";
import { Badge } from "../../components/ui/badge";
import { LEAVE_TYPE_OPTIONS } from "../../lib/leaveTypes";

const PAGE_INFO = [
  "Planned leave — LOA, Annual Leave, Medical Leave, or Other.",
  "Only takes live effect for current members of ECICS - SG (BS) / ECICS - MY (BS) — recording leave for anyone else is still saved here, but has no automatic In Office effect.",
  "Adding/editing/cancelling a period covering TODAY updates that person's In Office status immediately (LOA always overrides that day's Public Holiday result). A future or past period has no immediate effect.",
  "Adding, editing, or cancelling a leave above only recalculates that ONE person — never anyone else, even other people who also have a leave record here.",
  "\"Run update now\" is different: it recalculates everyone who currently has a leave record here (a manual catch-up), but still never touches a whole SG/MY group the way the Public Holidays page's refresh does.",
  "The scheduled 00:00 SGT/MYT job resets managed users first, then reapplies Public Holidays and this table, every day.",
  "This is separate from the same-day manual In Office toggle on the main dashboard page — use that for an unplanned same-day change instead.",
].join("\n");

type Group = { id: string; name: string; displayName?: string };
type Member = { identifier: string; email: string; name: string };

type LeaveRecord = {
  id: string;
  uipathId: string;
  email: string | null;
  leaveType: string;
  startDate: string;
  endDate: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
};

type Row = LeaveRecord & { dirty: boolean; saving: boolean };

// Same shapes lib/dailyStatusRefresh.ts returns. UserLoaRefreshResult is one
// person (refreshUserStatus — what add/edit/cancel below call, strictly
// scoped to the affected row's person only). LeaveStatusRefreshResult is the
// batch shape (runLeaveStatusRefresh — "Run update now" only, a distinct
// manual catch-up over everyone with a leave record).
type UserLoaRefreshResult = {
  uipathId: string;
  email?: string;
  managed: boolean;
  hasActiveLoa: boolean;
  inOffice?: boolean;
  reason?: string;
};

type LeaveStatusRefreshResult = {
  date: string;
  affectedCount: number;
  managedCount: number;
  activeCount: number;
  results: UserLoaRefreshResult[];
};

function summarizeLeaveRefresh(r: LeaveStatusRefreshResult): string {
  return `${r.affectedCount} with a leave record (${r.managedCount} managed, ${r.activeCount} currently on active LOA).`;
}

function summarizeUserResult(r: UserLoaRefreshResult): string {
  const who = r.email || r.uipathId;
  if (!r.managed) return `${who}: not a current SG/MY group member — no live In Office change.`;
  return `${who}: ${r.inOffice ? "In Office" : "Out of Office"} / ${r.reason}${r.hasActiveLoa ? " (active LOA)" : ""}`;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function statusFor(row: { startDate: string; endDate: string }): { label: string; variant: "default" | "secondary" | "outline" } {
  const today = todayStr();
  if (today < row.startDate) return { label: "Upcoming", variant: "secondary" };
  if (today > row.endDate) return { label: "Ended", variant: "outline" };
  return { label: "Active", variant: "default" };
}

let nextToastId = 1;

export default function LeavePage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<{ id: number; message: string; kind: ToastKind }[]>([]);

  const [groups, setGroups] = useState<Group[]>([]);
  const [newGroupId, setNewGroupId] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [newMemberId, setNewMemberId] = useState("");
  const [newLeaveType, setNewLeaveType] = useState<string>(LEAVE_TYPE_OPTIONS[0]);
  const [newStartDate, setNewStartDate] = useState("");
  const [newEndDate, setNewEndDate] = useState("");
  const [newNote, setNewNote] = useState("");
  const [adding, setAdding] = useState(false);
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<LeaveStatusRefreshResult | null>(null);

  useEffect(() => {
    loadLeave();
    fetch("/api/dashboard/groups")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setGroups(data.groups || []);
      })
      .catch((err) => setError(err?.message || "Failed to load groups"));
  }, []);

  useEffect(() => {
    if (!newGroupId) {
      setMembers([]);
      return;
    }
    setLoadingMembers(true);
    setNewMemberId("");
    fetch(`/api/dashboard/groups/${newGroupId}/members`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        const list: Member[] = data.members || [];
        list.sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
        setMembers(list);
      })
      .catch((err) => pushToast(err?.message || "Failed to load members", "error"))
      .finally(() => setLoadingMembers(false));
  }, [newGroupId]);

  function pushToast(message: string, kind: ToastKind) {
    const id = nextToastId++;
    setToasts((prev) => [...prev, { id, message, kind }]);
  }

  function dismissToast(id: number) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  async function loadLeave() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/dashboard/leave");
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const leave: LeaveRecord[] = data.leave || [];
      setRows(leave.map((l) => ({ ...l, dirty: false, saving: false })));
    } catch (err: any) {
      setError(err?.message || "Failed to load leave records");
    } finally {
      setLoading(false);
    }
  }

  function updateRow(id: string, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch, dirty: true } : r)));
  }

  async function saveRow(row: Row) {
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, saving: true } : r)));
    try {
      const res = await fetch("/api/dashboard/leave", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: row.id,
          leaveType: row.leaveType,
          startDate: row.startDate,
          endDate: row.endDate,
          note: row.note || "",
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...data.leave, dirty: false, saving: false } : r)));
      // refresh here is a single-person UserLoaRefreshResult (refreshUserStatus),
      // not the batch LeaveStatusRefreshResult "Run update now" returns — it
      // only ever describes this one row's person, so it's shown as a toast,
      // not folded into the persistent "Last run" panel below.
      const refresh: UserLoaRefreshResult | undefined = data.refresh;
      pushToast(`Saved leave for ${row.email || row.uipathId}. ${refresh ? summarizeUserResult(refresh) : ""}`, "success");
      if (data.refreshError) pushToast(`Refresh failed: ${data.refreshError}`, "error");
    } catch (err: any) {
      pushToast(err?.message || "Failed to save", "error");
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, saving: false } : r)));
    }
  }

  async function cancelRow(row: Row) {
    if (!window.confirm(`Cancel ${row.leaveType} for ${row.email || row.uipathId} (${row.startDate} to ${row.endDate})?`)) return;
    try {
      const res = await fetch(`/api/dashboard/leave?id=${encodeURIComponent(row.id)}`, { method: "DELETE" });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      const refresh: UserLoaRefreshResult | undefined = data.refresh;
      pushToast(`Cancelled leave for ${row.email || row.uipathId}. ${refresh ? summarizeUserResult(refresh) : ""}`, "info");
      if (data.refreshError) pushToast(`Refresh failed: ${data.refreshError}`, "error");
    } catch (err: any) {
      pushToast(err?.message || "Failed to cancel", "error");
    }
  }

  async function runUpdateNow() {
    setRunning(true);
    try {
      const res = await fetch("/api/dashboard/leave/run", { method: "POST" });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const result: LeaveStatusRefreshResult = data;
      setLastRun(result);
      pushToast(`Ran for ${result.date}. ${summarizeLeaveRefresh(result)}`, "info");
    } catch (err: any) {
      pushToast(err?.message || "Failed to run update", "error");
    } finally {
      setRunning(false);
    }
  }

  async function addLeave() {
    const member = members.find((m) => m.identifier === newMemberId);
    if (!member) return pushToast("Pick a user.", "error");
    if (!newStartDate) return pushToast("Pick a start date.", "error");
    if (!newEndDate) return pushToast("Pick an end date.", "error");
    if (newEndDate < newStartDate) return pushToast("End date must be on or after start date.", "error");

    setAdding(true);
    try {
      const res = await fetch("/api/dashboard/leave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uipathId: member.identifier,
          email: member.email,
          leaveType: newLeaveType,
          startDate: newStartDate,
          endDate: newEndDate,
          note: newNote.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const leave: LeaveRecord = data.leave;
      setRows((prev) =>
        [...prev, { ...leave, dirty: false, saving: false }].sort((a, b) => a.startDate.localeCompare(b.startDate))
      );
      setNewStartDate("");
      setNewEndDate("");
      setNewNote("");
      const refresh: UserLoaRefreshResult | undefined = data.refresh;
      pushToast(
        `Added ${newLeaveType} for ${member.name || member.email}. ${refresh ? summarizeUserResult(refresh) : ""}`,
        "success"
      );
      if (data.refreshError) pushToast(`Refresh failed: ${data.refreshError}`, "error");
    } catch (err: any) {
      pushToast(err?.message || "Failed to add leave", "error");
    } finally {
      setAdding(false);
    }
  }

  return (
    <TooltipProvider>
      <DashboardLayout>
        <div className="mb-6">
          <h1 className="inline-flex items-center gap-1.5 text-xl font-semibold">
            Leave Management
            <InfoTooltip text={PAGE_INFO} />
          </h1>
          <p className="text-sm text-muted-foreground">
            Record planned out-of-office periods (LOA, Annual Leave, Medical Leave, Other) in advance.
          </p>
        </div>

        <div className="mb-6 flex flex-wrap items-end gap-3 rounded-lg border p-4">
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Group</span>
            <Select value={newGroupId} onValueChange={setNewGroupId}>
              <SelectTrigger className="w-52">
                <SelectValue placeholder="Select a group" />
              </SelectTrigger>
              <SelectContent>
                {groups.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.displayName || g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">User</span>
            <Select value={newMemberId} onValueChange={setNewMemberId} disabled={!newGroupId || loadingMembers}>
              <SelectTrigger className="w-52">
                <SelectValue placeholder={loadingMembers ? "Loading..." : "Select a user"} />
              </SelectTrigger>
              <SelectContent>
                {members.map((m) => (
                  <SelectItem key={m.identifier} value={m.identifier}>
                    {m.name || m.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Leave type</span>
            <Select value={newLeaveType} onValueChange={setNewLeaveType}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LEAVE_TYPE_OPTIONS.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Start</span>
            <Input type="date" value={newStartDate} onChange={(e) => setNewStartDate(e.target.value)} className="w-40" />
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">End</span>
            <Input type="date" value={newEndDate} onChange={(e) => setNewEndDate(e.target.value)} className="w-40" />
          </label>
          <label className="grid flex-1 gap-1.5">
            <span className="text-sm font-medium">Note (optional)</span>
            <Input value={newNote} onChange={(e) => setNewNote(e.target.value)} placeholder="Note" />
          </label>
          <Button onClick={addLeave} disabled={adding}>
            {adding ? "Adding..." : "Add leave"}
          </Button>
        </div>

        <div className="mb-6 flex flex-wrap items-center gap-3">
          <Button variant="outline" onClick={runUpdateNow} disabled={running}>
            {running ? "Running..." : "Run update now"}
          </Button>
          <span className="text-sm text-muted-foreground">
            Manual catch-up: recalculates everyone who currently has a leave record here (LOA {">"} Public Holiday
            {">"} Normal). Adding, editing, or cancelling a leave above already does this for just that one person
            automatically — this button is for re-checking everyone at once.
          </span>
        </div>

        {lastRun && (
          <div className="mb-6 rounded-lg border p-4 text-sm">
            <p className="mb-2 font-medium">Last run — {lastRun.date}</p>
            <p className="mb-2 text-muted-foreground">{summarizeLeaveRefresh(lastRun)}</p>
            {lastRun.results.length > 0 && (
              <div className="grid gap-1 text-muted-foreground">
                {lastRun.results.map((r) => (
                  <p key={r.uipathId}>{summarizeUserResult(r)}</p>
                ))}
              </div>
            )}
          </div>
        )}

        {error && <p className="mb-4 text-sm text-destructive">{error}</p>}
        {loading && <p className="text-sm text-muted-foreground">Loading leave records...</p>}

        {!loading && rows.length > 0 && (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Start</TableHead>
                  <TableHead>End</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const status = statusFor(row);
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">{row.email || row.uipathId}</TableCell>
                      <TableCell>
                        <Badge variant={status.variant}>{status.label}</Badge>
                      </TableCell>
                      <TableCell className="w-36">
                        <Select value={row.leaveType} onValueChange={(v) => updateRow(row.id, { leaveType: v })}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {LEAVE_TYPE_OPTIONS.map((t) => (
                              <SelectItem key={t} value={t}>
                                {t}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="w-40">
                        <Input type="date" value={row.startDate} onChange={(e) => updateRow(row.id, { startDate: e.target.value })} />
                      </TableCell>
                      <TableCell className="w-40">
                        <Input type="date" value={row.endDate} onChange={(e) => updateRow(row.id, { endDate: e.target.value })} />
                      </TableCell>
                      <TableCell className="min-w-[200px]">
                        <Input value={row.note || ""} onChange={(e) => updateRow(row.id, { note: e.target.value })} placeholder="—" />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant={row.dirty ? "default" : "outline"}
                            disabled={!row.dirty || row.saving}
                            onClick={() => saveRow(row)}
                          >
                            {row.saving ? "Saving..." : "Save"}
                          </Button>
                          <Button size="sm" variant="destructive" onClick={() => cancelRow(row)}>
                            Cancel
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {!loading && rows.length === 0 && !error && (
          <p className="text-sm text-muted-foreground">No leave records yet — add one above.</p>
        )}

        <ToastStack toasts={toasts} onDismiss={dismissToast} />
      </DashboardLayout>
    </TooltipProvider>
  );
}
