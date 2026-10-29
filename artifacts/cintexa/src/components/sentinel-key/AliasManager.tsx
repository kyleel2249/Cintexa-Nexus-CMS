import { useState } from "react";
import { Link } from "wouter";
import { Archive, ArchiveRestore, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AliasForm, aliasMeta, shortId, type AliasRow } from "./AliasPicker";
import { Notice } from "./ui-bits";
import { Badge2, fmtDate, Select, useDebounced } from "./store-bits";
import { sk } from "@/lib/sentinel-key/store/api";
import { invalidateSk, useSk } from "@/lib/sentinel-key/store/queries";

function Row({ a }: { a: AliasRow }) {
  const [editing, setEditing] = useState(false); const [confirm, setConfirm] = useState(false); const [err, setErr] = useState<string | null>(null);
  const act = async (fn: () => Promise<unknown>) => { setErr(null); try { await fn(); invalidateSk(); setConfirm(false); } catch (x) { setErr(x instanceof Error ? x.message : "Failed."); } };
  const expired = a.expiresAt && new Date(a.expiresAt) < new Date();
  return (
    <li className="space-y-2 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0"><p className="font-medium break-words">{a.name} <span className="text-xs font-normal text-muted-foreground">#{shortId(a.id)}</span></p><p className="text-xs text-muted-foreground">{aliasMeta(a) || "No details"}</p></div>
        <div className="flex gap-1">{a.archivedAt && <Badge2 tone="muted">Archived</Badge2>}{expired && <Badge2 tone="bad">Expired</Badge2>}</div>
      </div>
      {a.tags.length > 0 && <p className="text-xs text-muted-foreground">{a.tags.map((t) => `#${t}`).join("  ")}</p>}
      {a.notes && <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">{a.notes}</p>}
      <p className="text-xs text-muted-foreground">{a.entryCount ?? 0} vault record{a.entryCount === 1 ? "" : "s"} · {a.eventCount ?? 0} history event{a.eventCount === 1 ? "" : "s"}{a.expiresAt ? ` · expires ${fmtDate(a.expiresAt)}` : ""}</p>
      {err && <p className="text-sm text-destructive" role="alert">{err}</p>}
      {editing ? <AliasForm initial={a} submitLabel="Save changes" onSaved={() => setEditing(false)} onCancel={() => setEditing(false)} /> : (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}><Pencil /> Edit / rename</Button>
          {(a.entryCount ?? 0) > 0 && <Link href={`/sentinel-key/vault?alias=${a.id}`}><span className="inline-flex cursor-pointer items-center rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-secondary">View records</span></Link>}
          {a.archivedAt ? <Button type="button" variant="outline" size="sm" onClick={() => act(() => sk("POST", `/aliases/${a.id}/restore`))}><ArchiveRestore /> Restore</Button> : <Button type="button" variant="outline" size="sm" onClick={() => act(() => sk("POST", `/aliases/${a.id}/archive`))}><Archive /> Archive</Button>}
          <Button type="button" variant="outline" size="sm" onClick={() => setConfirm(true)}><Trash2 /> Delete</Button>
        </div>)}
      {confirm && <div role="alertdialog" aria-label="Confirm deletion" className="space-y-2 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm"><p>Delete this alias permanently? Aliases that still have saved credentials or history cannot be deleted; archive them instead.</p><div className="flex gap-2"><Button type="button" variant="destructive" size="sm" onClick={() => act(() => sk("DELETE", `/aliases/${a.id}`))}>Delete alias</Button><Button type="button" variant="outline" size="sm" onClick={() => setConfirm(false)}>Cancel</Button></div></div>}
    </li>
  );
}

export function AliasManager() {
  const [q, setQ] = useState(""); const [archived, setArchived] = useState("false"); const [environment, setEnvironment] = useState(""); const [category, setCategory] = useState(""); const [creating, setCreating] = useState(false);
  const dq = useDebounced(q);
  const list = useSk<{ items: AliasRow[] }>("/aliases", { q: dq, archived, environment, category });
  const all = useSk<{ items: AliasRow[] }>("/aliases", { archived: "all" });
  const envs = [...new Set((all.data?.items ?? []).map((a) => a.environment).filter(Boolean))] as string[];
  const cats = [...new Set((all.data?.items ?? []).map((a) => a.category).filter(Boolean))] as string[];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-3">
        <div className="relative min-w-[180px] flex-1"><label htmlFor="a-q" className="text-xs font-medium text-muted-foreground">Search name, service, project, tag</label><Search className="absolute left-2.5 top-8 h-4 w-4 text-muted-foreground" aria-hidden /><input id="a-q" value={q} onChange={(e) => setQ(e.target.value)} className="h-9 w-full rounded-md border bg-background pl-8 pr-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" /></div>
        <Select id="a-env" label="Environment" value={environment} onChange={setEnvironment} className="w-40"><option value="">Any</option>{envs.map((e) => <option key={e}>{e}</option>)}</Select>
        <Select id="a-cat" label="Category" value={category} onChange={setCategory} className="w-40"><option value="">Any</option>{cats.map((e) => <option key={e}>{e}</option>)}</Select>
        <Select id="a-arch" label="Show" value={archived} onChange={setArchived} className="w-36"><option value="false">Active</option><option value="true">Archived</option><option value="all">All</option></Select>
        <Button type="button" onClick={() => setCreating((c) => !c)}><Plus /> New alias</Button>
      </div>
      {creating && <AliasForm onSaved={() => setCreating(false)} onCancel={() => setCreating(false)} />}
      {list.error && <p className="text-sm text-destructive" role="alert">{list.error.message}</p>}
      {list.loading && !list.data ? <p className="text-sm text-muted-foreground">Loading…</p> : (list.data?.items.length ?? 0) === 0 ? <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">No aliases found. Create one here or inline in any generator.</div> : <ul className="grid gap-3 lg:grid-cols-2">{list.data!.items.map((a) => <Row key={a.id} a={a} />)}</ul>}
      <Notice>Renaming an alias updates its name everywhere. Records stay linked by a stable ID, and History also keeps the name the alias had at generation time.</Notice>
    </div>
  );
}
