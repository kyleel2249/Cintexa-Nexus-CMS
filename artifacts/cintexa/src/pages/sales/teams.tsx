import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSales } from "@/context/SalesContext";
import { sales } from "@/lib/sales/api";
import { useSalesMutation, useSalesQuery, useUrlFilter } from "@/lib/sales/hooks";
import { ROLE_OPTIONS } from "@/lib/sales/labels";
import { PageHeader, Panel, TabBar, DataTable, StatusBadge, EmptyState, ErrorState, Skeleton, ConfirmModal, Modal,  Select, Tag, Checkbox } from "@/components/sales/ui";
import { FormModal } from "@/components/sales/forms";
import { RowsEditor } from "@/components/sales/RowsEditor";

interface Member { id: number; email: string; display_name: string; role: string; team_id: number | null; team_name: string | null; branch: string | null; active: boolean; hire_date: string | null }
interface Team { id: number; name: string; parent_team_id: number | null; manager_member_id: number | null; manager_name: string | null; branch: string | null; member_count: number }
interface Territory { id: number; name: string; description: string | null; countries: string[]; regions: string[]; industries: string[]; members: { member_id: number; name: string; is_primary: boolean }[] | null }
type Tab = "members" | "teams" | "territories";

export default function TeamsPage() {
  const { can } = useSales();
  const [tabRaw, setTab] = useUrlFilter("tab", "teams");
  const tab = (["members", "teams", "territories"].includes(tabRaw) ? tabRaw : "teams") as Tab;
  const tabs: { key: Tab; label: string }[] = [{ key: "teams", label: "Teams" }, { key: "territories", label: "Territories" }, ...(can("members:read") ? [{ key: "members" as Tab, label: "People & roles" }] : [])];
  return (
    <>
      <PageHeader title="Sales territories & teams" description="Teams scope what managers can see; territories drive assignment. Roles are enforced on the server for every request." />
      <TabBar<Tab> tabs={tabs} value={tab} onChange={setTab} />
      {tab === "members" ? <MembersTab /> : tab === "territories" ? <TerritoriesTab /> : <TeamsTab />}
    </>
  );
}

function useMembers() { return useSalesQuery<{ items: Member[] }>("/members"); }

function TeamsTab() {
  const { can } = useSales();
  const q = useSalesQuery<{ items: Team[] }>("/teams");
  const members = useSalesQuery<{ items: Member[] }>(can("members:read") ? "/members" : null);
  const [edit, setEdit] = useState<Team | "new" | null>(null);
  const [del, setDel] = useState<Team | null>(null);
  const remove = useSalesMutation((t: Team) => sales.del(`/teams/${t.id}`), { invalidate: ["/teams", "/members"], success: "Team deleted", onSuccess: () => setDel(null) });
  const write = can("teams:write");
  const mOpts = (members.data?.items ?? []).filter((m) => m.active).map((m) => ({ value: String(m.id), label: m.display_name }));
  const tOpts = (q.data?.items ?? []).filter((t) => edit === "new" || edit === null || t.id !== (edit as Team).id).map((t) => ({ value: String(t.id), label: t.name }));
  return (
    <>
      {write && <div className="mb-4 flex justify-end"><Button size="sm" onClick={() => setEdit("new")}><Plus className="mr-1.5 h-3.5 w-3.5" />New team</Button></div>}
      <Panel flush>
        {q.error && !q.data ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data ? <Skeleton /> : (
          <DataTable caption="Teams" rows={q.data.items} rowKey={(t) => t.id} empty={<EmptyState title="No teams yet" description="Create teams to group representatives and scope manager visibility." />} columns={[
            { key: "n", header: "Team", render: (t: Team) => t.name }, { key: "m", header: "Manager", render: (t: Team) => t.manager_name ?? "—" }, { key: "b", header: "Branch", hideOnMobile: true, render: (t: Team) => t.branch ?? "—" },
            { key: "c", header: "People", align: "right", render: (t: Team) => t.member_count }, { key: "x", header: "", render: (t: Team) => write ? <span className="flex justify-end gap-1"><Button size="sm" variant="ghost" onClick={() => setEdit(t)}>Edit</Button><Button size="sm" variant="ghost" className="text-rose-500" onClick={() => setDel(t)}>Delete</Button></span> : null },
          ]} />
        )}
      </Panel>
      {edit && <FormModal key={edit === "new" ? "new" : edit.id} open onClose={() => setEdit(null)} title={edit === "new" ? "New team" : "Edit team"} initial={edit === "new" ? {} : { ...edit, parent_team_id: edit.parent_team_id ?? "", manager_member_id: edit.manager_member_id ?? "" }} nullEmpty={edit !== "new"} success="Team saved" invalidate={["/teams", "/members"]}
        fields={[{ name: "name", label: "Name", required: true, wide: true }, { name: "branch", label: "Branch" }, { name: "manager_member_id", label: "Manager", type: "select", options: mOpts }, { name: "parent_team_id", label: "Parent team", type: "select", options: tOpts }]}
        submit={(b) => (edit === "new" ? sales.post("/teams", b) : sales.patch(`/teams/${edit.id}`, { name: b.name, branch: b.branch ?? null, manager_member_id: b.manager_member_id ?? null, parent_team_id: b.parent_team_id ?? null }))} />}
      <ConfirmModal open={!!del} onClose={() => setDel(null)} title="Delete team?" message="Members stay but lose their team. Teams with children can't be deleted." confirmLabel="Delete" danger pending={remove.pending} onConfirm={() => del && void remove.run(del)} />
    </>
  );
}

function TerritoriesTab() {
  const { can } = useSales();
  const q = useSalesQuery<{ items: Territory[] }>("/territories");
  const [creating, setCreating] = useState(false);
  const [assign, setAssign] = useState<Territory | null>(null);
  const [del, setDel] = useState<Territory | null>(null);
  const remove = useSalesMutation((t: Territory) => sales.del(`/territories/${t.id}`), { invalidate: ["/territories"], success: "Territory deleted", onSuccess: () => setDel(null) });
  const write = can("teams:write");
  return (
    <>
      {write && <div className="mb-4 flex justify-end"><Button size="sm" onClick={() => setCreating(true)}><Plus className="mr-1.5 h-3.5 w-3.5" />New territory</Button></div>}
      <Panel flush>
        {q.error && !q.data ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data ? <Skeleton /> : (
          <DataTable caption="Territories" rows={q.data.items} rowKey={(t) => t.id} empty={<EmptyState title="No territories" description="Define countries, regions or industries and assign representatives." />} columns={[
            { key: "n", header: "Territory", render: (t: Territory) => <div><p className="font-medium">{t.name}</p><p className="text-xs text-muted-foreground">{t.description}</p></div> },
            { key: "c", header: "Coverage", hideOnMobile: true, render: (t: Territory) => <div className="flex flex-wrap gap-1">{[...t.countries, ...t.regions, ...t.industries].slice(0, 6).map((x) => <Tag key={x}>{x}</Tag>)}</div> },
            { key: "m", header: "Assigned", render: (t: Territory) => (t.members ?? []).map((m) => m.name).join(", ") || "—" },
            { key: "x", header: "", render: (t: Territory) => write ? <span className="flex justify-end gap-1"><Button size="sm" variant="ghost" onClick={() => setAssign(t)}>Assign people</Button><Button size="sm" variant="ghost" className="text-rose-500" onClick={() => setDel(t)}>Delete</Button></span> : null },
          ]} />
        )}
      </Panel>
      <FormModal open={creating} onClose={() => setCreating(false)} title="New territory" success="Territory created" invalidate={["/territories"]}
        fields={[{ name: "name", label: "Name", required: true, wide: true }, { name: "description", label: "Description", wide: true }, { name: "countries", label: "Countries", type: "tags" }, { name: "regions", label: "Regions", type: "tags" }, { name: "industries", label: "Industries", type: "tags" }]} submit={(b) => sales.post("/territories", b)} />
      {assign && <AssignModal t={assign} onClose={() => setAssign(null)} />}
      <ConfirmModal open={!!del} onClose={() => setDel(null)} title="Delete territory?" message="Accounts keep their data but lose the territory link." confirmLabel="Delete" danger pending={remove.pending} onConfirm={() => del && void remove.run(del)} />
    </>
  );
}

function AssignModal({ t, onClose }: { t: Territory; onClose: () => void }) {
  const members = useMembers();
  const [rows, setRows] = useState((t.members ?? []).map((m) => ({ member_id: String(m.member_id), is_primary: m.is_primary })));
  const save = useSalesMutation(() => sales.put(`/territories/${t.id}/members`, { members: rows.map((r) => ({ member_id: Number(r.member_id), is_primary: r.is_primary })) }), { invalidate: ["/territories"], success: "Assignments saved", onSuccess: onClose });
  return (
    <Modal open onClose={onClose} title={`People in ${t.name}`} footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={save.pending || rows.some((r) => !r.member_id)} onClick={() => void save.run()}>Save</Button></>}>
      <RowsEditor rows={rows} onChange={setRows} blank={() => ({ member_id: "", is_primary: false })} addLabel="Add person" emptyText="Nobody assigned." render={(r, up) => (<><Select aria-label="Person" value={r.member_id} onChange={(e) => up({ member_id: e.target.value })}><option value="">Select…</option>{members.data?.items.filter((m) => m.active).map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}</Select><Checkbox className="mb-0 mt-2" label="Primary" checked={r.is_primary} onChange={(e) => up({ is_primary: e.target.checked })} /></>)} />
      {save.error && <p role="alert" className="mt-2 text-sm text-rose-500">{save.error.message}</p>}
    </Modal>
  );
}

function MembersTab() {
  const { can, me } = useSales();
  const q = useSalesQuery<{ items: Member[]; roles: { value: string; label: string }[] }>("/members");
  const teams = useSalesQuery<{ items: Team[] }>(can("teams:read") ? "/teams" : null);
  const [edit, setEdit] = useState<Member | "new" | null>(null);
  const write = can("members:write");
  const roleOpts = q.data?.roles ?? ROLE_OPTIONS;
  const teamOpts = (teams.data?.items ?? []).map((t) => ({ value: String(t.id), label: t.name }));
  return (
    <>
      <p className="mb-3 rounded-md border bg-secondary/40 px-3 py-2 text-sm text-muted-foreground">People are matched to their CMS sign-in by email. Adding someone here gives them a sales role; it does not create a login.</p>
      {write && <div className="mb-4 flex justify-end"><Button size="sm" onClick={() => setEdit("new")}><Plus className="mr-1.5 h-3.5 w-3.5" />Add person</Button></div>}
      <Panel flush>
        {q.error && !q.data ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data ? <Skeleton /> : (
          <DataTable caption="Sales people" rows={q.data.items} rowKey={(m) => m.id} columns={[
            { key: "n", header: "Person", render: (m: Member) => <div><p className="font-medium">{m.display_name} {m.id === me?.member.id && <Tag>You</Tag>}</p><p className="text-xs text-muted-foreground">{m.email}</p></div> },
            { key: "r", header: "Role", render: (m: Member) => roleOpts.find((r) => r.value === m.role)?.label ?? m.role }, { key: "t", header: "Team", hideOnMobile: true, render: (m: Member) => m.team_name ?? "—" },
            { key: "s", header: "Status", render: (m: Member) => <StatusBadge status={m.active ? "active" : "archived"} label={m.active ? "Active" : "Deactivated"} /> },
            { key: "x", header: "", render: (m: Member) => write ? <Button size="sm" variant="ghost" onClick={() => setEdit(m)}>Edit</Button> : null },
          ]} />
        )}
      </Panel>
      {edit && <FormModal key={edit === "new" ? "new" : edit.id} open onClose={() => setEdit(null)} title={edit === "new" ? "Add person" : `Edit ${edit.display_name}`} initial={edit === "new" ? { role: "sales_rep" } : { ...edit, team_id: edit.team_id ?? "" }} nullEmpty={edit !== "new"} success="Saved" invalidate={["/members", "/teams"]}
        fields={[...(edit === "new" ? [{ name: "email", label: "Sign-in email", type: "email" as const, required: true, wide: true }] : []), { name: "display_name", label: "Name", required: true }, { name: "role", label: "Role", type: "select", options: roleOpts, required: true }, { name: "team_id", label: "Team", type: "select", options: teamOpts }, { name: "branch", label: "Branch" }, ...(edit === "new" ? [{ name: "hire_date", label: "Hire date", type: "date" as const }] : [{ name: "active", label: "Active (untick to deactivate)", type: "checkbox" as const }, { name: "coaching_notes", label: "Coaching notes (managers only)", type: "textarea" as const }])]}
        submit={(b) => (edit === "new" ? sales.post("/members", b) : sales.patch(`/members/${edit.id}`, b))} />}
    </>
  );
}
