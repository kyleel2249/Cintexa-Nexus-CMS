/** Users and Access: organisations, members, role assignment, role and permission administration. */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Empty, ErrorState, Field, Loading, NeedsOrg, Notice, Panel, Tabs, errMessage, fmtDate, post, useOrg, v1 } from "./client";

type Member = { user_ref: string; display_name: string | null; email: string | null; status: string; joined_at: string; roles: string[] };
type Role = { id: string; organization_id: string | null; name: string; slug: string; description: string | null; is_system: boolean; permissions: string[] };
type Permission = { code: string; name: string; category: string; description: string | null; restricted: boolean };

export default function UsersAccess() {
  const [tab, setTab] = useState<"orgs" | "members" | "roles">("members");
  return (
    <div>
      <Tabs
        tabs={[
          { id: "members", label: "Members" },
          { id: "roles", label: "Roles and permissions" },
          { id: "orgs", label: "Organisations" },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === "orgs" && <Organisations />}
      {tab === "members" && <Members />}
      {tab === "roles" && <Roles />}
    </div>
  );
}

function Organisations() {
  const { orgs, org, setOrgId, reload } = useOrg();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const create = useMutation({
    mutationFn: () => post<{ organization: { id: string } }>("/organizations", { name }),
    onSuccess: (r) => {
      setName("");
      reload();
      setOrgId(r.organization.id);
      void qc.invalidateQueries({ queryKey: ["ccdi", "v1"] });
    },
  });
  const setStatus = useMutation({
    mutationFn: (v: { id: string; status: string }) => post(`/organizations/${v.id}`, { status: v.status }, "PATCH"),
    onSuccess: () => reload(),
  });

  return (
    <div className="space-y-5">
      <Panel title="Create organisation" description="Each organisation is an isolated tenant: members, roles, credentials and settings never cross organisations.">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create.mutate();
          }}
        >
          <div className="min-w-64 flex-1">
            <Field label="Organisation name" htmlFor="org-name">
              <Input id="org-name" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} required />
            </Field>
          </div>
          <Button type="submit" disabled={create.isPending || !name.trim()}>
            {create.isPending ? "Creating…" : "Create"}
          </Button>
        </form>
        {create.isError && <div className="mt-3"><Notice kind="error">{errMessage(create.error)}</Notice></div>}
      </Panel>

      <Panel title="Organisations">
        {orgs.length === 0 ? (
          <Empty title="No organisations yet" hint="Create the first one above." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground">
                <tr><th className="py-2 pr-4">Name</th><th className="pr-4">Slug</th><th className="pr-4">Status</th><th /></tr>
              </thead>
              <tbody>
                {orgs.map((o) => (
                  <tr key={o.id} className="border-t border-border/40">
                    <td className="py-2 pr-4 font-medium">{o.name}{org?.id === o.id && <Badge variant="secondary" className="ml-2">selected</Badge>}</td>
                    <td className="pr-4 text-muted-foreground">{o.slug}</td>
                    <td className="pr-4">{o.status}</td>
                    <td className="space-x-2 py-2 text-right">
                      <Button size="sm" variant="outline" onClick={() => setOrgId(o.id)} disabled={org?.id === o.id}>Select</Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={setStatus.isPending}
                        onClick={() => setStatus.mutate({ id: o.id, status: o.status === "active" ? "suspended" : "active" })}
                      >
                        {o.status === "active" ? "Suspend" : "Activate"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {setStatus.isError && <div className="mt-3"><Notice kind="error">{errMessage(setStatus.error)}</Notice></div>}
      </Panel>
    </div>
  );
}

function Members() {
  const { orgId } = useOrg();
  const qc = useQueryClient();
  const key = ["ccdi", "v1", "members", orgId];
  const members = useQuery({ queryKey: key, enabled: !!orgId, queryFn: () => v1<{ members: Member[] }>(`/organizations/${orgId}/members?limit=100`) });
  const roles = useQuery({ queryKey: ["ccdi", "v1", "roles", orgId], enabled: !!orgId, queryFn: () => v1<{ roles: Role[] }>("/roles", { orgId }) });
  const [form, setForm] = useState({ userRef: "", email: "", displayName: "" });
  const [editing, setEditing] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);

  const refresh = () => void qc.invalidateQueries({ queryKey: key });
  const add = useMutation({
    mutationFn: () => post(`/organizations/${orgId}/members`, { userRef: form.userRef, email: form.email || undefined, displayName: form.displayName || undefined }),
    onSuccess: () => { setForm({ userRef: "", email: "", displayName: "" }); refresh(); },
  });
  const remove = useMutation({ mutationFn: (userRef: string) => v1(`/organizations/${orgId}/members/${encodeURIComponent(userRef)}`, { method: "DELETE" }), onSuccess: refresh });
  const saveRoles = useMutation({
    mutationFn: () => post(`/organizations/${orgId}/members/${encodeURIComponent(editing as string)}/roles`, { roleSlugs: picked }, "PUT"),
    onSuccess: () => { setEditing(null); refresh(); },
  });

  if (!orgId) return <NeedsOrg />;
  return (
    <div className="space-y-5">
      <Panel title="Add member" description="Members are identified by a stable user reference (user id or e-mail).">
        <form
          className="grid gap-3 sm:grid-cols-4"
          onSubmit={(e) => { e.preventDefault(); add.mutate(); }}
        >
          <Field label="User reference" htmlFor="m-ref"><Input id="m-ref" value={form.userRef} onChange={(e) => setForm({ ...form, userRef: e.target.value })} required maxLength={120} /></Field>
          <Field label="E-mail (optional)" htmlFor="m-email"><Input id="m-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="Display name (optional)" htmlFor="m-name"><Input id="m-name" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} maxLength={120} /></Field>
          <div className="flex items-end"><Button type="submit" disabled={add.isPending || !form.userRef.trim()}>{add.isPending ? "Adding…" : "Add member"}</Button></div>
        </form>
        {add.isError && <div className="mt-3"><Notice kind="error">{errMessage(add.error)}</Notice></div>}
      </Panel>

      <Panel title="Members">
        {members.isLoading && <Loading />}
        {members.isError && <ErrorState error={members.error} onRetry={() => void members.refetch()} />}
        {members.data && members.data.members.length === 0 && <Empty title="No members" hint="Add the first member above." />}
        {members.data && members.data.members.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground">
                <tr><th className="py-2 pr-4">User</th><th className="pr-4">Roles</th><th className="pr-4">Joined</th><th /></tr>
              </thead>
              <tbody>
                {members.data.members.map((m) => (
                  <tr key={m.user_ref} className="border-t border-border/40 align-top">
                    <td className="py-2 pr-4"><div className="font-medium">{m.display_name || m.user_ref}</div><div className="text-xs text-muted-foreground">{m.email || m.user_ref}</div></td>
                    <td className="pr-4">
                      {editing === m.user_ref ? (
                        <fieldset className="space-y-1">
                          <legend className="sr-only">Roles for {m.user_ref}</legend>
                          {roles.data?.roles.map((r) => (
                            <label key={r.id} className="flex items-center gap-2 text-sm">
                              <input type="checkbox" checked={picked.includes(r.slug)} onChange={(e) => setPicked(e.target.checked ? [...picked, r.slug] : picked.filter((s) => s !== r.slug))} />
                              {r.name}
                            </label>
                          ))}
                          {saveRoles.isError && <Notice kind="error">{errMessage(saveRoles.error)}</Notice>}
                        </fieldset>
                      ) : m.roles.length ? (
                        <div className="flex flex-wrap gap-1">{m.roles.map((r) => <Badge key={r} variant="secondary">{r}</Badge>)}</div>
                      ) : (
                        <span className="text-muted-foreground">No roles</span>
                      )}
                    </td>
                    <td className="pr-4 text-muted-foreground">{fmtDate(m.joined_at)}</td>
                    <td className="space-x-2 py-2 text-right whitespace-nowrap">
                      {editing === m.user_ref ? (
                        <>
                          <Button size="sm" onClick={() => saveRoles.mutate()} disabled={saveRoles.isPending}>Save</Button>
                          <Button size="sm" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
                        </>
                      ) : (
                        <>
                          <Button size="sm" variant="outline" onClick={() => { saveRoles.reset(); setEditing(m.user_ref); setPicked(m.roles); }}>Edit roles</Button>
                          <Button size="sm" variant="outline" disabled={remove.isPending} onClick={() => { if (window.confirm(`Remove ${m.user_ref} from this organisation?`)) remove.mutate(m.user_ref); }}>Remove</Button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {remove.isError && <div className="mt-3"><Notice kind="error">{errMessage(remove.error)}</Notice></div>}
      </Panel>
    </div>
  );
}

function Roles() {
  const { orgId } = useOrg();
  const qc = useQueryClient();
  const key = ["ccdi", "v1", "roles", orgId];
  const roles = useQuery({ queryKey: key, enabled: !!orgId, queryFn: () => v1<{ roles: Role[] }>("/roles", { orgId }) });
  const perms = useQuery({ queryKey: ["ccdi", "v1", "permissions", orgId], enabled: !!orgId, queryFn: () => v1<{ permissions: Permission[] }>("/permissions", { orgId }) });
  const [name, setName] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const [editing, setEditing] = useState<Role | null>(null);

  const refresh = () => void qc.invalidateQueries({ queryKey: key });
  const create = useMutation({
    mutationFn: () => post(`/organizations/${orgId}/roles`, { name, permissions: chosen }),
    onSuccess: () => { setName(""); setChosen([]); refresh(); },
  });
  const save = useMutation({
    mutationFn: () => post(`/organizations/${orgId}/roles/${editing?.id}/permissions`, { permissions: chosen }, "PUT"),
    onSuccess: () => { setEditing(null); setChosen([]); refresh(); },
  });

  if (!orgId) return <NeedsOrg />;
  const categories = [...new Set(perms.data?.permissions.map((p) => p.category) ?? [])];
  const toggle = (code: string, on: boolean) => setChosen(on ? [...chosen, code] : chosen.filter((c) => c !== code));

  return (
    <div className="space-y-5">
      <Panel
        title={editing ? `Edit permissions: ${editing.name}` : "Create custom role"}
        description="Restricted permissions are never granted by an administrator role. You can only grant permissions you hold yourself."
      >
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); (editing ? save : create).mutate(); }}>
          {!editing && (
            <div className="max-w-sm"><Field label="Role name" htmlFor="role-name"><Input id="role-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} required /></Field></div>
          )}
          {perms.isLoading && <Loading />}
          {perms.isError && <ErrorState error={perms.error} onRetry={() => void perms.refetch()} />}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {categories.map((cat) => (
              <fieldset key={cat} className="rounded-lg border border-border/50 p-3">
                <legend className="px-1 text-xs font-semibold uppercase text-muted-foreground">{cat.replace(/_/g, " ")}</legend>
                {perms.data?.permissions.filter((p) => p.category === cat).map((p) => (
                  <label key={p.code} className="flex items-start gap-2 py-0.5 text-sm" title={p.description ?? ""}>
                    <input className="mt-1" type="checkbox" checked={chosen.includes(p.code)} onChange={(e) => toggle(p.code, e.target.checked)} />
                    <span>{p.name}{p.restricted && <Badge variant="destructive" className="ml-1.5">restricted</Badge>}</span>
                  </label>
                ))}
              </fieldset>
            ))}
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={(editing ? save : create).isPending || (!editing && !name.trim())}>{editing ? "Save permissions" : "Create role"}</Button>
            {editing && <Button type="button" variant="outline" onClick={() => { setEditing(null); setChosen([]); }}>Cancel</Button>}
          </div>
          {(create.isError || save.isError) && <Notice kind="error">{errMessage(create.error ?? save.error)}</Notice>}
        </form>
      </Panel>

      <Panel title="Roles">
        {roles.isLoading && <Loading />}
        {roles.isError && <ErrorState error={roles.error} onRetry={() => void roles.refetch()} />}
        <ul className="divide-y divide-border/40">
          {roles.data?.roles.map((r) => (
            <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{r.name} {r.is_system ? <Badge variant="secondary">system</Badge> : <Badge variant="outline">custom</Badge>}</div>
                {r.description && <p className="text-sm text-muted-foreground">{r.description}</p>}
                <p className="mt-1 break-words text-xs text-muted-foreground">{r.permissions.length} permissions{r.permissions.length ? `: ${r.permissions.join(", ")}` : ""}</p>
              </div>
              {!r.is_system && <Button size="sm" variant="outline" onClick={() => { setEditing(r); setChosen(r.permissions); }}>Edit permissions</Button>}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
