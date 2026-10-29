import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown, Plus, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sk } from "@/lib/sentinel-key/store/api";
import { invalidateSk, useSk } from "@/lib/sentinel-key/store/queries";
import { cn } from "@/lib/utils";
import { Notice, TextField } from "./ui-bits";

export interface AliasRow { id: string; name: string; category: string | null; service: string | null; project: string | null; environment: string | null; notes: string | null; tags: string[]; expiresAt: string | null; archivedAt: string | null; entryCount?: number; eventCount?: number }

export const aliasMeta = (a: Pick<AliasRow, "service" | "environment" | "project" | "category">) => [a.service, a.environment, a.project, a.category].filter(Boolean).join(" · ");
export const shortId = (id: string) => id.slice(0, 6);

export function AliasForm({ initialName = "", initial, onSaved, onCancel, submitLabel = "Create alias" }: { initialName?: string; initial?: AliasRow; onSaved: (a: AliasRow) => void; onCancel?: () => void; submitLabel?: string }) {
  const [f, setF] = useState({ name: initial?.name ?? initialName, category: initial?.category ?? "", service: initial?.service ?? "", project: initial?.project ?? "", environment: initial?.environment ?? "", tags: (initial?.tags ?? []).join(", "), expiresAt: initial?.expiresAt?.slice(0, 10) ?? "", notes: initial?.notes ?? "" });
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (!f.name.trim()) return setErr("An alias name is required.");
    setBusy(true); setErr(null);
    const body = { name: f.name.trim(), category: f.category, service: f.service, project: f.project, environment: f.environment, notes: f.notes, tags: f.tags.split(",").map((t) => t.trim()).filter(Boolean), expiresAt: f.expiresAt ? new Date(`${f.expiresAt}T00:00:00Z`).toISOString() : null };
    try {
      const a = initial ? await sk<AliasRow>("PATCH", `/aliases/${initial.id}`, { body }) : await sk<AliasRow>("POST", "/aliases", { body: { id: crypto.randomUUID(), ...body } });
      invalidateSk(); onSaved(a);
    } catch (x) { setErr(x instanceof Error ? x.message : "Could not save the alias."); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-3 rounded-lg border border-primary/30 bg-background/60 p-3" role="group" aria-label={initial ? "Edit alias" : "New alias"}>
      <TextField id="al-name" label="Alias name" value={f.name} onChange={(name) => set({ name })} maxLength={120} placeholder="GitHub – Development" />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField id="al-service" label="Service or app" value={f.service} onChange={(service) => set({ service })} maxLength={80} />
        <TextField id="al-env" label="Environment" value={f.environment} onChange={(environment) => set({ environment })} maxLength={40} placeholder="production, staging…" />
        <TextField id="al-project" label="Project" value={f.project} onChange={(project) => set({ project })} maxLength={80} />
        <TextField id="al-cat" label="Category" value={f.category} onChange={(category) => set({ category })} maxLength={60} />
        <TextField id="al-tags" label="Tags (comma separated)" value={f.tags} onChange={(tags) => set({ tags })} maxLength={400} />
        <div className="space-y-1.5"><label htmlFor="al-exp" className="text-sm font-medium">Expiry date</label><input id="al-exp" type="date" value={f.expiresAt} onChange={(e) => set({ expiresAt: e.target.value })} className="h-9 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" /></div>
      </div>
      <div className="space-y-1.5"><label htmlFor="al-notes" className="text-sm font-medium">Notes</label><textarea id="al-notes" rows={2} maxLength={2000} value={f.notes} onChange={(e) => set({ notes: e.target.value })} className="w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" /></div>
      <p className="text-xs text-amber-500">Alias names, tags and notes are not encrypted. Never put passwords, tokens or other secrets in them.</p>
      {err && <p className="text-sm text-destructive" role="alert">{err}</p>}
      <div className="flex gap-2"><Button type="button" onClick={submit} disabled={busy}>{busy ? "Saving…" : submitLabel}</Button>{onCancel && <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>}</div>
    </div>
  );
}

/** Required alias selector with autocomplete over existing aliases and inline creation. */
export function AliasPicker({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) {
  const { data, loading, error } = useSk<{ items: AliasRow[] }>("/aliases");
  const items = data?.items ?? [];
  const [created, setCreated] = useState<AliasRow | null>(null);
  const selected = items.find((a) => a.id === value) ?? (created && created.id === value ? created : null);
  const [text, setText] = useState(""); const [open, setOpen] = useState(false); const [active, setActive] = useState(0); const [creating, setCreating] = useState(false);
  const id = useId(); const box = useRef<HTMLDivElement>(null);
  const q = text.trim().toLowerCase();
  const matches = useMemo(() => items.filter((a) => !q || `${a.name} ${aliasMeta(a)} ${a.tags.join(" ")}`.toLowerCase().includes(q)).slice(0, 8), [items, q]);
  const exact = items.some((a) => a.name.trim().toLowerCase() === q);
  const rows = [...matches.map((a) => ({ kind: "alias" as const, a })), ...(q && !exact ? [{ kind: "create" as const }] : [])];

  useEffect(() => { if (!loading && value && !selected) onChange(null); }, [loading, value, selected, onChange]);
  useEffect(() => { const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); }; document.addEventListener("mousedown", close); return () => document.removeEventListener("mousedown", close); }, []);
  const pick = (a: AliasRow) => { setCreated(a); onChange(a.id); setText(""); setOpen(false); setCreating(false); };
  const choose = (i: number) => { const r = rows[i]; if (!r) return; if (r.kind === "alias") pick(r.a); else { setCreating(true); setOpen(false); } };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((i) => Math.min(i + 1, rows.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter" && open) { e.preventDefault(); choose(active); }
    else if (e.key === "Escape") setOpen(false);
  };

  return (
    <div className="space-y-2" ref={box}>
      <label htmlFor={`${id}-in`} className="text-sm font-medium">Alias <span className="text-destructive" aria-hidden>*</span><span className="sr-only">(required)</span></label>
      <p className="text-xs text-muted-foreground" id={`${id}-hint`}>What is this credential for? Examples: Gmail – Personal Account, Cintexa – Production API.</p>
      <div className="relative">
        <input id={`${id}-in`} role="combobox" aria-expanded={open} aria-controls={`${id}-list`} aria-autocomplete="list" aria-describedby={`${id}-hint`} aria-activedescendant={open && rows[active] ? `${id}-o${active}` : undefined} aria-required="true"
          value={text} placeholder={selected ? `${selected.name}  (type to change)` : "Search or type a new alias"} autoComplete="off" spellCheck={false}
          onChange={(e) => { setText(e.target.value); setOpen(true); setActive(0); }} onFocus={() => setOpen(true)} onKeyDown={onKey}
          className="h-10 w-full rounded-md border bg-background pl-3 pr-9 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
        <ChevronsUpDown className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-muted-foreground" aria-hidden />
        {open && rows.length > 0 && (
          <ul id={`${id}-list`} role="listbox" aria-label="Aliases" className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-lg border bg-popover p-1 shadow-lg">
            {rows.map((r, i) => (
              <li key={r.kind === "alias" ? r.a.id : "create"} id={`${id}-o${i}`} role="option" aria-selected={i === active} onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); choose(i); }}
                className={cn("flex cursor-pointer items-start gap-2 rounded-md px-3 py-2 text-sm", i === active && "bg-secondary")}>
                {r.kind === "alias" ? (<><Tag className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden /><div className="min-w-0"><p className="font-medium truncate">{r.a.name}{r.a.id === value && <Check className="ml-1 inline h-3.5 w-3.5 text-emerald-500" aria-label="selected" />}</p><p className="text-xs text-muted-foreground truncate">{[aliasMeta(r.a), `${r.a.entryCount ?? 0} saved`, `#${shortId(r.a.id)}`].filter(Boolean).join(" · ")}</p></div></>)
                  : (<><Plus className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden /><span>Create new alias “{text.trim()}”</span></>)}
              </li>))}
          </ul>)}
      </div>
      {error && <p className="text-xs text-destructive" role="alert">Aliases could not be loaded: {error.message}</p>}
      {selected ? <p className="flex flex-wrap items-center gap-x-2 text-sm" role="status"><Check className="h-4 w-4 text-emerald-500" aria-hidden /><b>{selected.name}</b><span className="text-xs text-muted-foreground">{[aliasMeta(selected), `#${shortId(selected.id)}`].filter(Boolean).join(" · ")}</span></p>
        : !loading && <p className="text-xs text-amber-500" role="status">No alias selected. Generation is disabled until you choose or create one.</p>}
      {!loading && items.length === 0 && !creating && <Button type="button" variant="outline" size="sm" onClick={() => setCreating(true)}><Plus /> Create your first alias</Button>}
      {creating && <AliasForm initialName={text.trim()} onSaved={pick} onCancel={() => setCreating(false)} />}
    </div>
  );
}
export { Notice };
