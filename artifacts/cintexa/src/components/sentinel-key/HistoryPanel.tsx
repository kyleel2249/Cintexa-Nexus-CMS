import { useState } from "react";
import { Link, useSearch } from "wouter";
import { Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "./ui-bits";
import { Badge2, fmtDate, Pager, Select, settingsText, TYPE_LABEL, TYPES, useDebounced } from "./store-bits";
import { sk } from "@/lib/sentinel-key/store/api";
import { invalidateSk, useSk } from "@/lib/sentinel-key/store/queries";
import type { AliasRow } from "./AliasPicker";

interface Ev { id: string; aliasId: string; aliasName: string; aliasNameAtGeneration: string; type: string; settings: Record<string, unknown>; itemCount: number; status: "pending" | "saved" | "failed"; failureCode: string | null; vaultEntryId: string | null; createdAt: string }
const FAIL_TEXT: Record<string, string> = { generation_failed: "generation failed", encryption_failed: "encryption failed", save_failed: "saving failed", key_locked: "vault was locked", aborted: "interrupted" };

function StatusBadge({ e }: { e: Ev }) {
  if (e.status === "saved") return e.vaultEntryId ? <Badge2 tone="ok">Saved</Badge2> : <Badge2 tone="muted">Saved · vault record deleted</Badge2>;
  if (e.status === "failed") return <Badge2 tone="bad">Incomplete · {FAIL_TEXT[e.failureCode ?? ""] ?? "failed"}</Badge2>;
  return <Badge2 tone="warn">Incomplete · pending</Badge2>;
}

function Row({ e, highlight }: { e: Ev; highlight: boolean }) {
  const [confirm, setConfirm] = useState<null | "event" | "both">(null); const [err, setErr] = useState<string | null>(null);
  const del = async (withVault: boolean) => { try { await sk("DELETE", `/history/${e.id}`, { query: { withVault: withVault || undefined } }); setConfirm(null); invalidateSk(); } catch (x) { setErr(x instanceof Error ? x.message : "Delete failed."); } };
  const renamed = e.aliasName !== e.aliasNameAtGeneration;
  return (
    <li id={`event-${e.id}`} className={`space-y-2 rounded-xl border bg-card p-4 ${highlight ? "ring-2 ring-primary" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0"><p className="font-medium break-words">{e.aliasName}</p>{renamed && <p className="text-xs text-muted-foreground">Named “{e.aliasNameAtGeneration}” when generated</p>}</div>
        <StatusBadge e={e} />
      </div>
      <p className="text-xs text-muted-foreground">{TYPE_LABEL[e.type] ?? e.type}{e.itemCount > 1 ? ` × ${e.itemCount}` : ""} · {settingsText(e.settings) || "no settings"} · {fmtDate(e.createdAt)}</p>
      {e.status !== "saved" && <p className="text-xs text-amber-500">No secret was stored for this event, so it cannot be retried from here. Generate again under the same alias.</p>}
      {err && <p className="text-sm text-destructive" role="alert">{err}</p>}
      <div className="flex flex-wrap gap-2">
        {e.vaultEntryId && <Link href={`/sentinel-key/vault?entry=${e.vaultEntryId}`}><span className="inline-flex cursor-pointer items-center rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-secondary">Open Vault record</span></Link>}
        <Button type="button" variant="outline" size="sm" onClick={() => setConfirm("event")}><Trash2 /> Delete event</Button>
        {e.vaultEntryId && <Button type="button" variant="outline" size="sm" onClick={() => setConfirm("both")}><Trash2 /> Delete event and vault record</Button>}
      </div>
      {confirm && (
        <div role="alertdialog" aria-label="Confirm deletion" className="space-y-2 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm">
          <p>{confirm === "event" ? "Delete this history event only? The encrypted vault record, if any, is kept." : "Delete this history event AND its encrypted vault record? The credential can no longer be retrieved."} This cannot be undone.</p>
          <div className="flex gap-2"><Button type="button" variant="destructive" size="sm" onClick={() => del(confirm === "both")}>{confirm === "event" ? "Delete event only" : "Delete both"}</Button><Button type="button" variant="outline" size="sm" onClick={() => setConfirm(null)}>Cancel</Button></div>
        </div>)}
    </li>
  );
}

export function HistoryPanel() {
  const sp = new URLSearchParams(useSearch());
  const eventParam = sp.get("event");
  const [q, setQ] = useState(""); const [type, setType] = useState(""); const [aliasId, setAliasId] = useState(""); const [status, setStatus] = useState(sp.get("status") ?? "");
  const [from, setFrom] = useState(""); const [to, setTo] = useState(""); const [sort, setSort] = useState("created"); const [dir, setDir] = useState("desc"); const [page, setPage] = useState(1); const [pageSize, setPageSize] = useState("10");
  const dq = useDebounced(q);
  const aliases = useSk<{ items: AliasRow[] }>("/aliases", { archived: "all" });
  const list = useSk<{ items: Ev[]; total: number }>("/history", { q: dq, type, aliasId, status, sort, dir, page, pageSize, id: eventParam ?? undefined, from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined, to: to ? new Date(`${to}T23:59:59.999`).toISOString() : undefined });
  const reset = () => setPage(1);
  const total = list.data?.total ?? 0;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 rounded-xl border bg-card p-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative"><label htmlFor="h-q" className="text-xs font-medium text-muted-foreground">Search alias</label><Search className="absolute left-2.5 top-8 h-4 w-4 text-muted-foreground" aria-hidden /><input id="h-q" value={q} onChange={(e) => { setQ(e.target.value); reset(); }} className="h-9 w-full rounded-md border bg-background pl-8 pr-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" /></div>
        <Select id="h-type" label="Type" value={type} onChange={(v) => { setType(v); reset(); }}><option value="">All types</option>{TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}</Select>
        <Select id="h-alias" label="Alias" value={aliasId} onChange={(v) => { setAliasId(v); reset(); }}><option value="">All aliases</option>{(aliases.data?.items ?? []).map((a) => <option key={a.id} value={a.id}>{a.name} (#{a.id.slice(0, 6)}){a.archivedAt ? " – archived" : ""}</option>)}</Select>
        <Select id="h-status" label="Storage status" value={status} onChange={(v) => { setStatus(v); reset(); }}><option value="">Any status</option><option value="saved">Saved</option><option value="incomplete">Incomplete (any)</option><option value="failed">Failed</option><option value="pending">Pending</option></Select>
        <div className="space-y-1"><label htmlFor="h-from" className="text-xs font-medium text-muted-foreground">From date</label><input id="h-from" type="date" value={from} max={to || undefined} onChange={(e) => { setFrom(e.target.value); reset(); }} className="h-9 w-full rounded-md border bg-background px-2 text-sm" /></div>
        <div className="space-y-1"><label htmlFor="h-to" className="text-xs font-medium text-muted-foreground">To date</label><input id="h-to" type="date" value={to} min={from || undefined} onChange={(e) => { setTo(e.target.value); reset(); }} className="h-9 w-full rounded-md border bg-background px-2 text-sm" /></div>
        <Select id="h-sort" label="Sort" value={`${sort}:${dir}`} onChange={(v) => { const [s, d] = v.split(":"); setSort(s!); setDir(d!); reset(); }}><option value="created:desc">Newest first</option><option value="created:asc">Oldest first</option><option value="alias:asc">Alias A–Z</option><option value="type:asc">Type</option><option value="status:asc">Status</option></Select>
        <Select id="h-size" label="Per page" value={pageSize} onChange={(v) => { setPageSize(v); reset(); }}><option>10</option><option>25</option><option>50</option></Select>
      </div>
      {eventParam && <p className="text-sm">Showing one event. <Link href="/sentinel-key/history"><span className="cursor-pointer text-primary underline">Show all</span></Link></p>}
      {list.error && <p className="text-sm text-destructive" role="alert">{list.error.message}</p>}
      {list.loading && !list.data ? <p className="text-sm text-muted-foreground">Loading…</p>
        : total === 0 ? <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">No generation events match. Every generation, including failed ones, is recorded here.</div>
        : <ul className="grid gap-3 lg:grid-cols-2">{list.data!.items.map((e) => <Row key={e.id} e={e} highlight={e.id === eventParam} />)}</ul>}
      {!eventParam && <Pager page={page} pageSize={Number(pageSize)} total={total} onPage={setPage} />}
      <Notice>History stores what was generated and when, never the secret. To retrieve a credential, open its linked Vault record. Deleting an event does not delete the vault record, and the other way round, unless you choose that explicitly.</Notice>
    </div>
  );
}
