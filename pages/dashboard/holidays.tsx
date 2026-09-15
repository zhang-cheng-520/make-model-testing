import { useEffect, useState } from "react";
import { DashboardLayout } from "../../components/dashboard-layout";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { ToastStack, type ToastKind } from "../../components/ui/toast";
import { InfoTooltip } from "../../components/info-tooltip";
import { TooltipProvider } from "../../components/ui/tooltip";

const COUNTRY_OPTIONS = ["SG", "MY"] as const;
const VIEW_TABS = ["ALL", "SG", "MY"] as const;
type ViewTab = (typeof VIEW_TABS)[number];

const PAGE_INFO = [
  "Backs the public-holiday In-Office automation (Vercel Cron, daily, at noon SGT/MYT).",
  "On a date listed here, every member of that country's UiPath group (ECICS - SG (BS) / ECICS - MY (BS)) gets In Office switched off automatically — but never switched back on.",
  "Use \"Run update now\" below to trigger the same check on demand, e.g. right after adding a holiday dated today, instead of waiting for the daily cron tick.",
].join("\n");

type Holiday = {
  id: string;
  countryCode: string;
  date: string;
  name: string;
  lastUpdated: string;
  editorName: string | null;
};

type Row = Holiday & { dirty: boolean; saving: boolean };

type CountryRunResult = {
  isHoliday: boolean;
  holidayName?: string;
  groupName?: string;
  groupMemberCount?: number;
  updatedCount: number;
  newRowCount: number;
};

type RunResult = { date: string; sg: CountryRunResult; my: CountryRunResult };

let nextToastId = 1;

export default function HolidaysPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<{ id: number; message: string; kind: ToastKind }[]>([]);

  const [newCountry, setNewCountry] = useState<string>("SG");
  const [newDate, setNewDate] = useState("");
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [viewTab, setViewTab] = useState<ViewTab>("ALL");
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<RunResult | null>(null);

  useEffect(() => {
    loadHolidays();
  }, []);

  function pushToast(message: string, kind: ToastKind) {
    const id = nextToastId++;
    setToasts((prev) => [...prev, { id, message, kind }]);
  }

  function dismissToast(id: number) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  async function loadHolidays() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/dashboard/holidays");
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const holidays: Holiday[] = data.holidays || [];
      setRows(holidays.map((h) => ({ ...h, dirty: false, saving: false })));
    } catch (err: any) {
      setError(err?.message || "Failed to load holidays");
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
      const res = await fetch("/api/dashboard/holidays", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: row.id,
          countryCode: row.countryCode,
          date: row.date,
          name: row.name,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setRows((prev) =>
        prev.map((r) => (r.id === row.id ? { ...data.holiday, dirty: false, saving: false } : r))
      );
      pushToast(`Saved ${row.countryCode} ${row.date}.`, "success");
    } catch (err: any) {
      pushToast(err?.message || "Failed to save", "error");
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, saving: false } : r)));
    }
  }

  async function deleteRow(row: Row) {
    if (!window.confirm(`Delete ${row.countryCode} ${row.date} — ${row.name}?`)) return;
    try {
      const res = await fetch(`/api/dashboard/holidays?id=${encodeURIComponent(row.id)}`, { method: "DELETE" });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      pushToast(`Deleted ${row.countryCode} ${row.date}.`, "info");
    } catch (err: any) {
      pushToast(err?.message || "Failed to delete", "error");
    }
  }

  async function addHoliday() {
    if (!newDate) return pushToast("Pick a date.", "error");
    if (!newName.trim()) return pushToast("Enter a holiday name.", "error");
    setAdding(true);
    try {
      const res = await fetch("/api/dashboard/holidays", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ countryCode: newCountry, date: newDate, name: newName.trim() }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const holiday: Holiday = data.holiday;
      setRows((prev) =>
        [...prev, { ...holiday, dirty: false, saving: false }].sort(
          (a, b) => a.date.localeCompare(b.date) || a.countryCode.localeCompare(b.countryCode)
        )
      );
      setNewDate("");
      setNewName("");
      pushToast(`Added ${newCountry} ${holiday.date}.`, "success");
      // Test aid: immediately run the same sweep the daily cron does, so the
      // effect of a just-added holiday (e.g. dated today) is visible right away.
      await runUpdateNow();
    } catch (err: any) {
      pushToast(err?.message || "Failed to add holiday", "error");
    } finally {
      setAdding(false);
    }
  }

  async function runUpdateNow() {
    setRunning(true);
    try {
      const res = await fetch("/api/dashboard/holidays/run", { method: "POST" });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const result: RunResult = data;
      setLastRun(result);
      const summarize = (country: string, r: CountryRunResult) =>
        r.isHoliday
          ? `${country}: holiday (${r.holidayName}) — ${r.updatedCount} updated, ${r.newRowCount} new row(s)`
          : `${country}: not a holiday`;
      pushToast(`Ran for ${result.date}. ${summarize("SG", result.sg)}. ${summarize("MY", result.my)}.`, "info");
    } catch (err: any) {
      pushToast(err?.message || "Failed to run update", "error");
    } finally {
      setRunning(false);
    }
  }

  const visibleRows = viewTab === "ALL" ? rows : rows.filter((r) => r.countryCode === viewTab);
  const countFor = (tab: ViewTab) => (tab === "ALL" ? rows.length : rows.filter((r) => r.countryCode === tab).length);

  return (
    <TooltipProvider>
    <DashboardLayout>
      <div className="mb-6">
        <h1 className="inline-flex items-center gap-1.5 text-xl font-semibold">
          Public Holidays
          <InfoTooltip text={PAGE_INFO} />
        </h1>
        <p className="text-sm text-muted-foreground">
          Singapore and Malaysia public holidays used by the daily In Office automation.
        </p>
      </div>

      <div className="mb-6 flex flex-wrap items-end gap-3 rounded-lg border p-4">
        <label className="grid gap-1.5">
          <span className="text-sm font-medium">Country</span>
          <Select value={newCountry} onValueChange={setNewCountry}>
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COUNTRY_OPTIONS.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="grid gap-1.5">
          <span className="text-sm font-medium">Date</span>
          <Input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} className="w-40" />
        </label>
        <label className="grid flex-1 gap-1.5">
          <span className="text-sm font-medium">Name</span>
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Holiday name" />
        </label>
        <Button onClick={addHoliday} disabled={adding}>
          {adding ? "Adding..." : "Add holiday"}
        </Button>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={runUpdateNow} disabled={running}>
          {running ? "Running..." : "Run update now"}
        </Button>
        <span className="text-sm text-muted-foreground">
          Runs the same daily check immediately — good for testing after adding a holiday dated today.
        </span>
      </div>

      {lastRun && (
        <div className="mb-6 rounded-lg border p-4 text-sm">
          <p className="mb-2 font-medium">Last run — {lastRun.date}</p>
          <div className="grid gap-1 text-muted-foreground">
            {(["sg", "my"] as const).map((key) => {
              const r = lastRun[key];
              const label = key.toUpperCase();
              return (
                <p key={key}>
                  <span className="font-medium text-foreground">{label}:</span>{" "}
                  {r.isHoliday ? (
                    <>
                      holiday ({r.holidayName}) via {r.groupName} ({r.groupMemberCount} members) —{" "}
                      {r.updatedCount} updated, {r.newRowCount} new row(s)
                    </>
                  ) : (
                    "not a holiday, nothing changed"
                  )}
                </p>
              );
            })}
          </div>
        </div>
      )}

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}
      {loading && <p className="text-sm text-muted-foreground">Loading holidays...</p>}

      {!loading && rows.length > 0 && (
        <div className="mb-4 flex gap-1 border-b">
          {VIEW_TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setViewTab(tab)}
              className={
                "border-b-2 px-3 py-2 text-sm font-medium transition-colors " +
                (viewTab === tab
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground")
              }
            >
              {tab === "ALL" ? "All" : tab} ({countFor(tab)})
            </button>
          ))}
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Country</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Last updated</TableHead>
                <TableHead>Editor</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="w-24">
                    <Select
                      value={row.countryCode}
                      onValueChange={(v) => updateRow(row.id, { countryCode: v })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {COUNTRY_OPTIONS.map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="w-40">
                    <Input
                      type="date"
                      value={row.date}
                      onChange={(e) => updateRow(row.id, { date: e.target.value })}
                    />
                  </TableCell>
                  <TableCell className="min-w-[200px]">
                    <Input value={row.name} onChange={(e) => updateRow(row.id, { name: e.target.value })} />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(row.lastUpdated).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{row.editorName || "—"}</TableCell>
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
                      <Button size="sm" variant="destructive" onClick={() => deleteRow(row)}>
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {!loading && rows.length === 0 && !error && (
        <p className="text-sm text-muted-foreground">No holidays yet — add one above.</p>
      )}
      {!loading && rows.length > 0 && visibleRows.length === 0 && (
        <p className="text-sm text-muted-foreground">No {viewTab} holidays.</p>
      )}

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </DashboardLayout>
    </TooltipProvider>
  );
}
