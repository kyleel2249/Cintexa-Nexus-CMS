import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Sparkles, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSales } from "@/context/SalesContext";
import { useSalesQuery } from "@/lib/sales/hooks";
import type { Paged } from "@/lib/sales/list";
import { PageHeader, Panel, SearchBox, EmptyState, ErrorState, Checkbox, StatusBadge, TabBar, Skeleton } from "@/components/sales/ui";
import { Term, Hint } from "@/components/sales/Hint";
import { researchApi, TERMINAL, type PlanView } from "@/lib/sales/research-api";

type Kind = "account" | "lead";
interface Run { jobId: number | null; label: string; skippedReason?: string; view?: PlanView; applied?: { field: string; value: string }[]; applyError?: string; applying?: boolean }
const MAX = 25;
const accountGaps = (r: any) => ["website", "email", "phone", "industry", "city", "country"].filter((k) => r[k] === null || r[k] === "");
const leadGaps = (r: any) => ["industry", "country", "product_interest", "phone"].filter((k) => r[k] === null || r[k] === "");
const LBL: Record<string, string> = { website: "website", email: "email", phone: "phone", industry: "industry", city: "city", country: "country", product_interest: "product interest", region: "region", address: "address", postal_code: "postal code", tags: "tags", notes: "notes" };

/** Research many leads or accounts at once, review what would be filled (empty fields only), then apply the ones you accept. */
export default function Enrichment() {
  const { can } = useSales();
  const [kind, setKind] = useState<Kind>("account");
  const [q, setQ] = useState("");
  const [onlyGaps, setOnlyGaps] = useState(true);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [runs, setRuns] = useState<Record<number, Run>>({});
  const [err, setErr] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [accept, setAccept] = useState<Record<number, boolean>>({});
  const timer = useRef<number | null>(null);
  const alive = useRef(true);
  const canWrite = can(kind === "account" ? "accounts:write" : "leads:write");
  const list = useSalesQuery<Paged<any>>(kind === "account" ? "/accounts" : "/leads", { page: 1, pageSize: 100, q: q || undefined });
  const gaps = kind === "account" ? accountGaps : leadGaps;
  const rows = useMemo(() => (list.data?.items ?? []).filter((r) => !onlyGaps || gaps(r).length > 0), [list.data, onlyGaps, gaps]);
  const nameOf = (r: any) => (kind === "account" ? r.name : r.company || `${r.first_name} ${r.last_name ?? ""}`.trim());

  useEffect(() => { alive.current = true; return () => { alive.current = false; if (timer.current) window.clearTimeout(timer.current); }; }, []);
  useEffect(() => { setPicked(new Set()); setRuns({}); setAccept({}); setErr(null); }, [kind]);

  const pending = (r: Record<number, Run>) => Object.entries(r).filter(([, x]) => x.jobId && !(x.view && TERMINAL.includes(x.view.status)));
  function schedule(cur: Record<number, Run>) {
    if (timer.current) window.clearTimeout(timer.current);
    if (!pending(cur).length) return;
    timer.current = window.setTimeout(async () => {
      const next = { ...cur };
      await Promise.all(pending(cur).map(async ([id, run]) => {
        try { next[Number(id)] = { ...run, view: await researchApi.plan(run.jobId!) }; } catch (e: any) { next[Number(id)] = { ...run, view: { status: "failed", error: e?.message ?? "Lost contact", plan: null } }; }
      }));
      if (!alive.current) return;
      setRuns(next);
      setAccept((a) => { const n = { ...a }; for (const [id, r] of Object.entries(next)) if (n[Number(id)] === undefined && r.view?.plan?.fills.length) n[Number(id)] = true; return n; });
      schedule(next);
    }, 1800);
  }

  async function start(refresh = false) {
    setErr(null); setStarting(true);
    try {
      const res = await researchApi.bulk({ entity_type: kind, ids: [...picked], refresh });
      const next: Record<number, Run> = {};
      for (const i of res.items) next[i.entityId] = { jobId: i.jobId, label: i.label, skippedReason: i.state === "skipped" ? i.reason : undefined };
      setRuns(next); setAccept({}); schedule(next);
    } catch (e: any) { setErr(e?.message ?? "Could not start the research"); }
    setStarting(false);
  }

  const reviewable = Object.entries(runs).filter(([, r]) => r.view?.plan?.fills.length && !r.applied);
  const toApply = reviewable.filter(([id]) => accept[Number(id)]);
  async function applyAll() {
    setErr(null);
    for (const [id, r] of toApply) {
      setRuns((x) => ({ ...x, [Number(id)]: { ...x[Number(id)]!, applying: true } }));
      try {
        const res = await researchApi.apply(r.jobId!);
        setRuns((x) => ({ ...x, [Number(id)]: { ...x[Number(id)]!, applying: false, applied: res.applied } }));
      } catch (e: any) { setRuns((x) => ({ ...x, [Number(id)]: { ...x[Number(id)]!, applying: false, applyError: e?.message ?? "Could not apply" } })); }
    }
  }
  const running = pending(runs).length;
  const toggle = (id: number) => setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.size < MAX && n.add(id); return n; });

  return (
    <>
      <PageHeader title="Bulk Enrichment" description="Research up to 25 leads or accounts at once from their public websites, review what would be filled, then apply. Only EMPTY fields are ever filled; names and existing values are never changed." />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <TabBar<Kind> tabs={[{ key: "account", label: "Accounts" }, { key: "lead", label: "Leads" }]} value={kind} onChange={setKind} />
        <div className="min-w-[14rem] flex-1"><SearchBox value={q} onChange={setQ} placeholder={`Search ${kind === "account" ? "accounts" : "leads"}`} /></div>
        <Checkbox label={<>Only records with missing data<Hint text="Hides records that already have website, email, phone, industry and location filled in." /></>} checked={onlyGaps} onChange={(e) => setOnlyGaps(e.target.checked)} />
      </div>
      {!canWrite && <p role="alert" className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-sm">Your role cannot edit {kind}s, so you cannot enrich them.</p>}
      {err && <p role="alert" className="mb-3 rounded-md border border-rose-500/30 bg-rose-500/10 p-2 text-sm text-rose-500">{err}</p>}
      {Object.keys(runs).length === 0 ? (
        <Panel title={`Choose ${kind}s (${picked.size}/${MAX})`} flush actions={<Button type="button" size="sm" disabled={!picked.size || starting || !canWrite} onClick={() => void start()}>{starting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}<Term term="Research Company">Research selected</Term> ({picked.size})</Button>}>
          {list.loading && !list.data ? <div className="p-4"><Skeleton rows={4} /></div> : list.error ? <ErrorState error={list.error} onRetry={list.refetch} /> : rows.length === 0 ? <EmptyState title="Nothing to enrich" description={onlyGaps ? "Every record shown already has its key details. Untick the filter to see all." : "No records found."} /> : (
            <ul className="divide-y">
              {rows.map((r) => (
                <li key={r.id}><label className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-secondary/40">
                  <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={picked.has(r.id)} disabled={!picked.has(r.id) && picked.size >= MAX} onChange={() => toggle(r.id)} />
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{nameOf(r) || `#${r.id}`}</span><span className="block truncate text-xs text-muted-foreground">{r.website || r.email || r.number}</span></span>
                  <span className="hidden text-xs text-muted-foreground sm:block">Missing: {gaps(r).map((g) => LBL[g] ?? g).join(", ") || "nothing"}</span>
                </label></li>
              ))}
            </ul>
          )}
        </Panel>
      ) : (
        <Panel title={running ? `Researching… ${Object.keys(runs).length - running}/${Object.keys(runs).length} done` : "Review"} flush actions={<span className="flex gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => { if (timer.current) window.clearTimeout(timer.current); setRuns({}); setAccept({}); }}>Back to list</Button>
          <Button type="button" size="sm" disabled={!toApply.length || running > 0} onClick={() => void applyAll()}><Check className="mr-1.5 h-3.5 w-3.5" /><Term term="Apply selected">Apply</Term> to {toApply.length} record{toApply.length === 1 ? "" : "s"}</Button></span>}>
          <ul className="divide-y">
            {Object.entries(runs).map(([id, r]) => {
              const v = r.view, fills = v?.plan?.fills ?? [];
              return (
                <li key={id} className="flex gap-3 px-4 py-3">
                  <div className="pt-0.5">{fills.length > 0 && !r.applied ? <input aria-label={`Apply to ${r.label}`} type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={!!accept[Number(id)]} onChange={(e) => setAccept((a) => ({ ...a, [Number(id)]: e.target.checked }))} /> : <span className="block h-4 w-4" />}</div>
                  <div className="min-w-0 flex-1 text-sm">
                    <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{r.label}</span>{r.skippedReason ? <span className="text-xs text-muted-foreground">Skipped: {r.skippedReason}</span> : v ? <StatusBadge status={v.status} /> : <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Queued" />}{v && !TERMINAL.includes(v.status) && <span className="text-xs text-muted-foreground">{v.progress ?? 0}% {v.stage}</span>}</div>
                    {v?.status === "failed" && <p className="text-xs text-rose-500">{v.error}</p>}
                    {r.applied ? <p className="mt-1 text-xs text-emerald-600">Filled {r.applied.length} empty field(s): {r.applied.map((a) => `${LBL[a.field] ?? a.field} = ${a.value}`).join("; ")}</p> : r.applyError ? <p className="mt-1 text-xs text-rose-500">{r.applyError}</p> : r.applying ? <p className="mt-1 text-xs text-muted-foreground">Applying…</p> : v?.plan ? (
                      <>
                        {fills.length ? <ul className="mt-1 space-y-0.5 text-xs">{fills.map((f) => <li key={f.field}><span className="text-muted-foreground">{LBL[f.field] ?? f.field}:</span> {f.value} <span className="text-muted-foreground">· {Math.round(f.confidence * 100)}% · <Term term={f.verification}>{f.verification.replace("_", " ")}</Term>{f.sourceUrl && <> · <a className="text-primary hover:underline" href={f.sourceUrl} target="_blank" rel="noreferrer noopener">source</a></>}</span></li>)}</ul> : <p className="mt-1 text-xs text-muted-foreground">Nothing safe to fill.</p>}
                        {v.plan.skipped.length > 0 && <p className="mt-1 text-[11px] text-muted-foreground">Left alone: {v.plan.skipped.map((s) => `${LBL[s.field] ?? s.field} (${s.reason})`).join("; ")}</p>}
                      </>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">Values are copied only into fields that are empty right now, and only when confidence is at least 55%, the value is valid, and the sources do not conflict. Everything applied is recorded in the audit log. Use the record's own form to review lower-confidence suggestions.</p>
        </Panel>
      )}
    </>
  );
}
