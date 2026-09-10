import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import { DashboardLayout } from "../../components/dashboard-layout";
import { Switch } from "../../components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { TooltipProvider } from "../../components/ui/tooltip";
import { CategoryPicker } from "../../components/category-picker";
import { InfoTooltip } from "../../components/info-tooltip";

const IN_OFFICE_INFO = [
  "Drives automatic task routing: only members marked In Office are considered for the least-workload assignment in this group.",
  "If nobody in this group is in office, tasks route to the \"Case Assigners\" group instead, applying the same logic there.",
  "If nobody in Case Assigners is in office either, one member is picked at random as a last resort.",
  "New members default to In Office until changed here.",
].join("\n");

type Group = { id: string; name: string; displayName?: string };
type Member = { identifier: string; email: string; name: string };
type MetadataRow = { uipath_id: string; in_office: boolean; categories: string[]; updated_at: string };

type Row = {
  identifier: string;
  name: string;
  email: string;
  inOffice: boolean;
  categories: string[];
  dirty: boolean;
  saving: boolean;
  savedAt?: string;
};

export default function DashboardPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string>("");
  const [rows, setRows] = useState<Row[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(true);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/dashboard/groups")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setGroups(data.groups || []);
      })
      .catch((err) => setError(err?.message || "Failed to load groups"))
      .finally(() => setLoadingGroups(false));
  }, []);

  useEffect(() => {
    if (!selectedGroupId) return;
    setLoadingMembers(true);
    setError(null);
    (async () => {
      try {
        const membersRes = await fetch(`/api/dashboard/groups/${selectedGroupId}/members`);
        const membersData = await membersRes.json();
        if (membersData.error) throw new Error(membersData.error);
        const members: Member[] = membersData.members || [];

        const ids = members.map((m) => m.identifier).join(",");
        const metaRes = await fetch(`/api/dashboard/metadata?ids=${encodeURIComponent(ids)}`);
        const metaData = await metaRes.json();
        if (metaData.error) throw new Error(metaData.error);
        const metaByUipathId = new Map<string, MetadataRow>(
          (metaData.rows as MetadataRow[]).map((r) => [r.uipath_id, r])
        );

        const merged: Row[] = members.map((m) => {
          const meta = metaByUipathId.get(m.identifier);
          return {
            identifier: m.identifier,
            name: m.name,
            email: m.email,
            inOffice: meta ? meta.in_office : true,
            categories: meta?.categories || [],
            dirty: false,
            saving: false,
          };
        });
        merged.sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
        setRows(merged);
      } catch (err: any) {
        setError(err?.message || "Failed to load group members");
        setRows([]);
      } finally {
        setLoadingMembers(false);
      }
    })();
  }, [selectedGroupId]);

  function updateRow(identifier: string, patch: Partial<Row>) {
    setRows((prev) =>
      prev.map((r) => (r.identifier === identifier ? { ...r, ...patch, dirty: true } : r))
    );
  }

  async function saveRow(row: Row) {
    setRows((prev) => prev.map((r) => (r.identifier === row.identifier ? { ...r, saving: true } : r)));
    try {
      const res = await fetch("/api/dashboard/metadata", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uipathId: row.identifier,
          email: row.email,
          inOffice: row.inOffice,
          categories: row.categories,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setRows((prev) =>
        prev.map((r) =>
          r.identifier === row.identifier
            ? { ...r, dirty: false, saving: false, savedAt: new Date().toLocaleTimeString() }
            : r
        )
      );
    } catch (err: any) {
      setError(err?.message || "Failed to save");
      setRows((prev) => prev.map((r) => (r.identifier === row.identifier ? { ...r, saving: false } : r)));
    }
  }

  return (
    <TooltipProvider>
    <DashboardLayout>
      <div className="mb-6">
        <h1 className="inline-flex items-center gap-1.5 text-xl font-semibold">
          Case Assignment Dashboard
          <InfoTooltip text={IN_OFFICE_INFO} />
        </h1>
        <p className="text-sm text-muted-foreground">
          Members mirror UiPath live. Membership itself can only be changed in UiPath.
        </p>
      </div>

      <div className="mb-4 max-w-xs">
        <Select value={selectedGroupId} onValueChange={setSelectedGroupId}>
          <SelectTrigger>
            <SelectValue placeholder={loadingGroups ? "Loading groups..." : "Select a group"} />
          </SelectTrigger>
          <SelectContent>
            {groups.map((g) => (
              <SelectItem key={g.id} value={g.id}>
                {g.displayName || g.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      {loadingMembers && <p className="text-sm text-muted-foreground">Loading members...</p>}

      {!loadingMembers && selectedGroupId && rows.length === 0 && !error && (
        <p className="text-sm text-muted-foreground">No members found in this group.</p>
      )}

      {rows.length > 0 && (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>In Office</TableHead>
                <TableHead>Categories</TableHead>
                <TableHead className="text-right">Save</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.identifier}>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell className="text-muted-foreground">{row.email}</TableCell>
                  <TableCell>
                    <Switch
                      checked={row.inOffice}
                      onCheckedChange={(checked) => updateRow(row.identifier, { inOffice: checked })}
                    />
                  </TableCell>
                  <TableCell className="min-w-[280px]">
                    <CategoryPicker
                      value={row.categories}
                      onChange={(next) => updateRow(row.identifier, { categories: next })}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant={row.dirty ? "default" : "outline"}
                      disabled={!row.dirty || row.saving}
                      onClick={() => saveRow(row)}
                    >
                      {row.saving ? "Saving..." : row.dirty ? "Save" : row.savedAt ? "Saved" : "Save"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </DashboardLayout>
    </TooltipProvider>
  );
}
