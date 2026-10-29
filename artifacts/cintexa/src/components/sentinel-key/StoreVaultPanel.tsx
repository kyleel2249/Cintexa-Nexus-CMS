import { useState } from "react";
import { Link, useSearch } from "wouter";
import { Download, Eye, Lock, Pencil, Pin, PinOff, Search, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice, TextField } from "./ui-bits";
import { SecretField } from "./SecretField";
import { VaultKeyGate, STORE_WHERE } from "./StorageControls";
import { Badge2, fmtDate, Pager, Select, settingsText, TYPE_LABEL, TYPES, useDebounced } from "./store-bits";
import { sk } from "@/lib/sentinel-key/store/api";
import { aadFor, open } from "@/lib/sentinel-key/store/crypto";
import { getKey, useKeyring } from "@/lib/sentinel-key/store/keyring";
import { invalidateSk, useSk } from "@/lib/sentinel-key/store/queries";
import { downloadText } from "@/lib/sentinel-key/clipboard";
import type { AliasRow } from "./AliasPicker";

interface Entry { id: string; type: string; aliasId: string; aliasName: string; settings: Record<string, unknown>; itemCount: number; category: string | null; tags: string[]; notes: string | null; expiresAt: string | null; pinned: boolean; favorite: boolean; historyEventId: string | null; lastAccessedAt: string | null; createdAt: string; updatedAt: string }
const msg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");

function EditForm({ e, aliases, onDone }: { e: Entry; aliases: AliasRow[]; onDone: () => void }) {
  const [f, setF] = useState({ category: e.category ?? "", tags: e.tags.join(", "), notes: e.notes ?? "", expiresAt: e.expiresAt?.slice(0, 10) ?? "", aliasId: e.aliasId });
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    try { await sk("PATCH", `/vault/${e.id}`, { body: { category: f.category, tags: f.tags.split(",").map((t) => t.trim()).filter(Boolean), notes: f.notes, expiresAt: f.expiresAt ? new Date(`${f.expiresAt}T00:00:00Z`).toISOString() : null, aliasId: f.aliasId } }); invalidateSk(); onDone(); } catch (x) { setErr(msg(x)); }
  };
  return (
    <div className="space-y-3 rounded-lg border border-primary/30 p-3">
      <Select id={`ea-${e.id}`} label="Alias" value={f.aliasId} onChange={(aliasId) => setF({ ...f, aliasId })}>{aliases.map((a) => <option key={a.id} value={a.id}>{a.name} (#{a.id.slice(0, 6)})</option>)}</Select>
      <div className="grid gap-3 sm:grid-cols-2"><TextField id={`ec-${e.id}`} label="Category" value={f.category} onChange={(category) => setF({ ...f, category })} maxLength={60} /><TextField id={`et-${e.id}`} label="Tags (comma separated)" value={f.tags} onChange={(tags) => setF({ ...f, tags })} maxLength={400} /></div>
      <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1.5"><label htmlFor={`ex-${e.id}`} className="text-sm font-medium">Expiry date</label><input id={`ex-${e.id}`} type="date" value={f.expiresAt} onChange={(ev) => setF({ ...f, expiresAt: ev.target.value })} className="h-9 w-full rounded-md border bg-background px-3 text-sm" /></div></div>
      <div className="space-y-1.5"><label htmlFor={`en-${e.id}`} className="text-sm font-medium">Notes</label><textarea id={`en-${e.id}`} rows={2} maxLength={2000} value={f.notes} onChange={(ev) => setF({ ...f, notes: ev.target.value })} className="w-full rounded-md border bg-background px-3 py-2 text-sm" /></div>
      <p className="text-xs text-amber-500">Notes and tags are not encrypted. Do not store secrets in them.</p>
      {err && <p className="text-sm text-destructive" role="alert">{err}</p>}
      <div className="flex gap-2"><Button type="button" size="sm" onClick={save}>Save</Button><Button type="button" size="sm" variant="outline" onClick={onDone}>Cancel</Button></div>
    </div>
  );
}

function EntryCard({ e, aliases, highlight }: { e: Entry; aliases: AliasRow[]; highlight: boolean }) {
  const { phase } = useKeyring();
  const [secret, setSecret] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false); const [confirm, setConfirm] = useState<null | "record" | "both">(null);
  const expired = e.expiresAt && new Date(e.expiresAt) < new Date(); const soon = e.expiresAt && !expired && new Date(e.expiresAt).getTime() - Date.now() < 14 * 864e5;
  const reveal = async () => {
    setErr(null);
    const key = getKey(); if (!key) { setErr("Unlock the vault to reveal this value."); return; }
    try {
      const r = await sk<{ iv: string; ciphertext: string }>("GET", `/vault/${e.id}`);
      setSecret(await open(key, { iv: r.iv, ciphertext: r.ciphertext }, aadFor(e.id, e.type))); invalidateSk();
    } catch (x) { setErr(x instanceof DOMException || (x as Error)?.name === "OperationError" ? "Could not decrypt: wrong master password for this record, or the data was modified." : msg(x)); }
  };
  const patch = async (b: object) => { try { await sk("PATCH", `/vault/${e.id}`, { body: b }); invalidateSk(); } catch (x) { setErr(msg(x)); } };
  const del = async (withHistory: boolean) => { try { await sk("DELETE", `/vault/${e.id}`, { query: { withHistory: withHistory || undefined } }); setConfirm(null); invalidateSk(); } catch (x) { setErr(msg(x)); } };
  return (
    <li id={`entry-${e.id}`} className={`rounded-xl border bg-card p-4 space-y-3 ${highlight ? "ring-2 ring-primary" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0"><p className="font-medium break-words">{e.aliasName}</p><p className="text-xs text-muted-foreground">{TYPE_LABEL[e.type] ?? e.type}{e.itemCount > 1 ? ` × ${e.itemCount}` : ""} · {settingsText(e.settings) || "no settings"}</p></div>
        <div className="flex flex-wrap items-center gap-1">
          {expired && <Badge2 tone="bad">Expired</Badge2>}{soon && <Badge2 tone="warn">Expires soon</Badge2>}
          <Button type="button" variant="ghost" size="icon" onClick={() => patch({ pinned: !e.pinned })} aria-pressed={e.pinned} aria-label={e.pinned ? "Unpin" : "Pin"}>{e.pinned ? <PinOff /> : <Pin />}</Button>
          <Button type="button" variant="ghost" size="icon" onClick={() => patch({ favorite: !e.favorite })} aria-pressed={e.favorite} aria-label={e.favorite ? "Remove favorite" : "Mark favorite"}><Star className={e.favorite ? "fill-amber-400 text-amber-400" : ""} /></Button>
        </div>
      </div>
      {(e.category || e.tags.length > 0) && <p className="text-xs text-muted-foreground">{[e.category, ...e.tags.map((t) => `#${t}`)].filter(Boolean).join("  ")}</p>}
      {e.notes && <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">{e.notes}</p>}
      {secret !== null ? <SecretField label="Stored credential" value={secret} onClear={() => setSecret(null)} /> : <div className="flex flex-wrap items-center gap-2"><div className="flex-1 min-w-[160px] rounded-lg border bg-background px-3 py-2.5 font-mono text-sm text-muted-foreground" aria-label="Masked value">••••••••••••••••</div><Button type="button" variant="outline" onClick={reveal} disabled={phase !== "unlocked"}><Eye /> Reveal</Button></div>}
      {phase !== "unlocked" && secret === null && <VaultKeyGate phase={phase} />}
      {err && <p className="text-sm text-destructive" role="alert">{err}</p>}
      <p className="text-xs text-muted-foreground">Created {fmtDate(e.createdAt)} · Last accessed {fmtDate(e.lastAccessedAt)}{e.expiresAt ? ` · Expires ${fmtDate(e.expiresAt)}` : ""}</p>
      {editing && <EditForm e={e} aliases={aliases} onDone={() => setEditing(false)} />}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setEditing((x) => !x)}><Pencil /> Edit details</Button>
        {e.historyEventId && <Link href={`/sentinel-key/history?event=${e.historyEventId}`}><span className="inline-flex cursor-pointer items-center rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-secondary">View history event</span></Link>}
        <Button type="button" variant="outline" size="sm" onClick={() => setConfirm("record")}><Trash2 /> Delete record</Button>
        {e.historyEventId && <Button type="button" variant="outline" size="sm" onClick={() => setConfirm("both")}><Trash2 /> Delete record and history</Button>}
      </div>
      {confirm && (
        <div role="alertdialog" aria-label="Confirm deletion" className="space-y-2 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm">
          <p>{confirm === "record" ? "Permanently delete this encrypted credential? Its history event will be kept and marked as having no vault record." : "Permanently delete this encrypted credential AND its generation history event?"} This cannot be undone.</p>
          <div className="flex gap-2"><Button type="button" variant="destructive" size="sm" onClick={() => del(confirm === "both")}>{confirm === "record" ? "Delete record only" : "Delete both"}</Button><Button type="button" variant="outline" size="sm" onClick={() => setConfirm(null)}>Cancel</Button></div>
        </div>)}
    </li>
  );
}

export function StoreVaultPanel() {
  const search = useSearch(); const params = new URLSearchParams(search);
  const entryParam = params.get("entry"); const aliasParam = params.get("alias");
  const { phase } = useKeyring();
  const [q, setQ] = useState(""); const [type, setType] = useState(""); const [aliasId, setAliasId] = useState(aliasParam ?? ""); const [flag, setFlag] = useState(""); const [sort, setSort] = useState("created"); const [dir, setDir] = useState("desc"); const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const aliases = useSk<{ items: AliasRow[] }>("/aliases", { archived: "all" });
  const list = useSk<{ items: Entry[]; total: number }>("/vault", { q: dq, type, aliasId, sort, dir, page, pageSize: 10, id: entryParam ?? undefined, pinned: flag === "pinned" || undefined, favorite: flag === "favorite" || undefined, expired: flag === "expired" || undefined });
  const [exportNote, setExportNote] = useState<string | null>(null);
  const exportAll = async () => { try { const d = await sk("GET", "/vault-export"); downloadText(`sentinel-key-vault-export-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(d, null, 2), "application/json"); setExportNote("Encrypted export downloaded. It contains only ciphertext and needs your master password."); } catch (x) { setExportNote(msg(x)); } };
  return (
    <div className="space-y-4">
      {phase !== "unlocked" && <div className="max-w-lg"><VaultKeyGate phase={phase} /></div>}
      <div className="grid gap-3 rounded-xl border bg-card p-3 sm:grid-cols-2 lg:grid-cols-6">
        <div className="relative lg:col-span-2"><label htmlFor="v-q" className="text-xs font-medium text-muted-foreground">Search alias, category, tag</label><Search className="absolute left-2.5 top-8 h-4 w-4 text-muted-foreground" aria-hidden /><input id="v-q" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="h-9 w-full rounded-md border bg-background pl-8 pr-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" /></div>
        <Select id="v-type" label="Type" value={type} onChange={(v) => { setType(v); setPage(1); }}><option value="">All types</option>{TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}</Select>
        <Select id="v-alias" label="Alias" value={aliasId} onChange={(v) => { setAliasId(v); setPage(1); }}><option value="">All aliases</option>{(aliases.data?.items ?? []).map((a) => <option key={a.id} value={a.id}>{a.name} (#{a.id.slice(0, 6)}){a.archivedAt ? " – archived" : ""}</option>)}</Select>
        <Select id="v-flag" label="Show" value={flag} onChange={(v) => { setFlag(v); setPage(1); }}><option value="">Everything</option><option value="pinned">Pinned</option><option value="favorite">Favorites</option><option value="expired">Expired</option></Select>
        <Select id="v-sort" label="Sort" value={`${sort}:${dir}`} onChange={(v) => { const [s, d] = v.split(":"); setSort(s!); setDir(d!); }}><option value="created:desc">Newest first</option><option value="created:asc">Oldest first</option><option value="alias:asc">Alias A–Z</option><option value="accessed:desc">Recently accessed</option><option value="type:asc">Type</option></Select>
      </div>
      {entryParam && <p className="text-sm">Showing one record. <Link href="/sentinel-key/vault"><span className="cursor-pointer text-primary underline">Show all</span></Link></p>}
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Lock className="h-3.5 w-3.5" aria-hidden />Values stay encrypted at rest on {STORE_WHERE}; they are decrypted in this browser only when you reveal them.</p><Button type="button" variant="outline" size="sm" onClick={exportAll}><Download /> Encrypted export</Button></div>
      {exportNote && <p className="text-xs text-muted-foreground" role="status">{exportNote}</p>}
      {list.error && <p className="text-sm text-destructive" role="alert">{list.error.message}</p>}
      {list.loading && !list.data ? <p className="text-sm text-muted-foreground">Loading…</p>
        : (list.data?.items.length ?? 0) === 0 ? <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">{list.data?.total === 0 && !q && !type && !aliasId && !flag && !entryParam ? "Your vault is empty. Generated credentials appear here automatically." : "No records match these filters."}</div>
        : <ul className="grid gap-3 lg:grid-cols-2">{list.data!.items.map((e) => <EntryCard key={e.id} e={e} aliases={(aliases.data?.items ?? []).filter((a) => !a.archivedAt)} highlight={e.id === entryParam} />)}</ul>}
      {!entryParam && <Pager page={page} pageSize={10} total={list.data?.total ?? 0} onPage={setPage} />}
      <Notice title="How this vault protects you">Each credential is encrypted in your browser with AES-256-GCM before it is stored; the database holds ciphertext only. Alias names, types, settings, tags, notes and dates are not encrypted. There is no master-password recovery. This is not a claim that metadata is private.</Notice>
    </div>
  );
}
