import { useMemo, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { ArrowLeft, ChevronDown, ChevronRight, RefreshCw, Sparkles } from "lucide-react";
import { CATEGORY_IDS, CATEGORY_SHORT_LABELS, FINDING_STATUSES, FINDING_STATUS_LABELS, TRANSITIONS, type FindingStatus, type FindingView, type Severity } from "@workspace/wi-core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAudit, useBundle, useExplain, usePatchFinding, useRetest } from "@/lib/website-intelligence/api";
import { EmptyState, ErrorNote, Loading, Panel, SeverityBadge, StatusBadge, WI, label } from "./components";

const select = "h-9 rounded-md border bg-background px-2 text-sm";
const SEVERITIES: Severity[] = ["critical", "high", "medium", "low", "info"];

export default function FindingsPage({ id }: { id: string }) {
  const search = useSearch();
  const [, nav] = useLocation();
  const params = new URLSearchParams(search);
  const [f, setF] = useState({ q: params.get("q") ?? "", severity: params.get("severity") ?? "", category: params.get("category") ?? "", status: params.get("status") ?? "", kind: params.get("kind") ?? "defect", confidence: params.get("confidence") ?? "", lineage: params.get("lineage") ?? "" });
  const [open, setOpen] = useState<string | null>(null);
  const audit = useAudit(id);
  const bundle = useBundle(id);
  const retest = useRetest(id);

  const list = useMemo(() => (bundle.data?.findings ?? []).filter((x) => {
    if (f.kind && x.kind !== f.kind) return false;
    if (f.severity && x.severity !== f.severity) return false;
    if (f.category && x.category !== f.category) return false;
    if (f.status && x.workflow.status !== f.status) return false;
    if (f.confidence && x.confidence !== f.confidence) return false;
    if (f.lineage && x.workflow.lineage !== f.lineage) return false;
    if (f.q && !`${x.title} ${x.description} ${x.testId} ${x.affectedUrls.join(" ")}`.toLowerCase().includes(f.q.toLowerCase())) return false;
    return true;
  }), [bundle.data, f]);

  if (bundle.isLoading || audit.isLoading) return <Loading />;
  if (bundle.error) return <ErrorNote error={bundle.error} />;
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v });

  return (
    <div className="space-y-4">
      <Link href={`${WI}/audits/${id}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />Back to {audit.data?.config.name || audit.data?.hostname}</Link>
      <div className="wi-no-print grid gap-2 md:grid-cols-4 lg:grid-cols-7">
        <Input placeholder="Search findings" value={f.q} onChange={(e) => set("q", e.target.value)} aria-label="Search findings" className="lg:col-span-2" />
        <select className={select} value={f.kind} onChange={(e) => set("kind", e.target.value)} aria-label="Kind"><option value="defect">Defects</option><option value="limitation">Testing limitations</option><option value="observation">Observations</option><option value="">All</option></select>
        <select className={select} value={f.severity} onChange={(e) => set("severity", e.target.value)} aria-label="Severity"><option value="">Any severity</option>{SEVERITIES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
        <select className={select} value={f.category} onChange={(e) => set("category", e.target.value)} aria-label="Category"><option value="">Any category</option>{CATEGORY_IDS.map((c) => <option key={c} value={c}>{CATEGORY_SHORT_LABELS[c]}</option>)}</select>
        <select className={select} value={f.status} onChange={(e) => set("status", e.target.value)} aria-label="Workflow status"><option value="">Any workflow status</option>{FINDING_STATUSES.map((s) => <option key={s} value={s}>{FINDING_STATUS_LABELS[s]}</option>)}</select>
        <select className={select} value={f.lineage} onChange={(e) => set("lineage", e.target.value)} aria-label="Since previous audit"><option value="">New and recurring</option><option value="new">New</option><option value="recurring">Recurring</option></select>
      </div>
      <p className="text-xs text-muted-foreground" aria-live="polite">{list.length} finding(s). Status changes are recorded per finding; a finding becomes Verified only through a passing retest or documented manual verification.</p>
      {retest.error && <ErrorNote error={retest.error} />}
      {!list.length ? <EmptyState title="No findings match" body="Adjust the filters. An empty result is not proof that an area is flawless: check category coverage on the dashboard." /> : (
        <ul className="space-y-2">
          {list.map((x) => (
            <li key={x.id} className="rounded-xl border bg-card">
              <button type="button" className="flex w-full items-start gap-3 p-3 text-left" onClick={() => setOpen(open === x.id ? null : x.id)} aria-expanded={open === x.id}>
                {open === x.id ? <ChevronDown className="mt-1 h-4 w-4 shrink-0" /> : <ChevronRight className="mt-1 h-4 w-4 shrink-0" />}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><SeverityBadge s={x.severity} /><span className="font-medium">{x.title}</span></div>
                  <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground"><span>{x.testId}</span><span>{CATEGORY_SHORT_LABELS[x.category]}</span><span>{x.affectedCount}{x.applicableCount ? ` of ${x.applicableCount}` : ""} affected</span><span>confidence {x.confidence}</span><span>{x.provenance}</span>{x.workflow.lineage && <span className="text-primary">{x.workflow.lineage}</span>}</div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1"><StatusBadge s={x.status} /><span className="text-xs">{FINDING_STATUS_LABELS[x.workflow.status]}</span></div>
              </button>
              {open === x.id && <FindingDetail auditId={id} f={x} onRetest={(fp) => retest.mutate([fp], { onSuccess: (r) => nav(`${WI}/audits/${r.id}`) })} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FindingDetail({ auditId, f, onRetest }: { auditId: string; f: FindingView; onRetest: (fp: string) => void }) {
  const patch = usePatchFinding(auditId);
  const explain = useExplain(auditId);
  const wf = f.workflow;
  const [status, setStatus] = useState<FindingStatus>(wf.status);
  const [owner, setOwner] = useState(wf.owner ?? "");
  const [due, setDue] = useState(wf.dueDate ?? "");
  const [notes, setNotes] = useState(wf.notes ?? "");
  const [rationale, setRationale] = useState(wf.rationale ?? "");
  const [manual, setManual] = useState("");
  const allowed = [wf.status, ...TRANSITIONS[wf.status]];
  const needsRationale = status === "accepted_risk" || status === "dismissed";
  const verifying = status === "verified" && status !== wf.status && wf.retestStatus !== "passed";

  const save = () => patch.mutate({ fp: f.fingerprint, patch: { status, owner: owner || null, dueDate: due || null, notes, ...(needsRationale ? { rationale } : {}), ...(verifying ? { manualVerification: { notes: manual } } : {}) } });

  return (
    <div className="space-y-4 border-t p-4 text-sm">
      <p>{f.description}</p>
      {(f.actual || f.expected) && <dl className="grid gap-1 rounded-lg bg-muted/40 p-3 text-xs">{f.actual && <div><dt className="inline font-medium">Observed: </dt><dd className="inline break-words">{f.actual}</dd></div>}{f.expected && <div><dt className="inline font-medium">Expected: </dt><dd className="inline break-words">{f.expected}</dd></div>}</dl>}
      {f.note && <p className="text-xs text-amber-300">{f.note}</p>}
      {f.affectedUrls.length > 0 && <div><h4 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Affected URLs ({f.affectedCount})</h4><ul className="space-y-0.5 text-xs">{f.affectedUrls.slice(0, 20).map((u) => <li key={u} className="break-all"><a className="underline" href={u} target="_blank" rel="noopener noreferrer">{u}</a></li>)}</ul></div>}
      {f.evidence.length > 0 && <div><h4 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Evidence (observed {new Date(f.observedAt).toLocaleString()})</h4>{f.evidence.slice(0, 6).map((e, i) => <div key={i} className="mb-2"><div className="text-xs font-medium">{e.label} <span className="text-muted-foreground">[{e.kind}]</span></div><pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/50 p-2 text-[11px]">{e.value}</pre></div>)}</div>}
      {f.kind === "defect" && (
        <div className="grid gap-3 md:grid-cols-2">
          <div><h4 className="text-xs font-semibold uppercase text-muted-foreground">Why it matters</h4><p className="text-xs">{[f.impact.user, f.impact.search, f.impact.business, f.impact.security].filter(Boolean).join(" ")}</p></div>
          <div><h4 className="text-xs font-semibold uppercase text-muted-foreground">Likely cause</h4><p className="text-xs">{f.rootCause}</p></div>
          <div><h4 className="text-xs font-semibold uppercase text-muted-foreground">Recommended fix</h4><p className="text-xs font-medium">{f.fix}</p><p className="mt-1 text-xs">{f.implementation}</p></div>
          <div><h4 className="text-xs font-semibold uppercase text-muted-foreground">How it was measured / verified</h4><p className="text-xs">{f.measurementMethod}</p><p className="mt-1 text-xs">{f.verify}</p><p className="mt-1 text-xs text-muted-foreground">Effort {f.effort} - priority {Math.round(f.priorityScore)}</p></div>
        </div>
      )}
      {f.refs.length > 0 && <ul className="flex flex-wrap gap-x-4 text-xs">{f.refs.map((r) => <li key={r.url}><a href={r.url} target="_blank" rel="noopener noreferrer" className="text-primary underline">{r.title}</a></li>)}</ul>}

      <div className="wi-no-print space-y-3 rounded-lg border p-3">
        <h4 className="text-xs font-semibold uppercase text-muted-foreground">Workflow</h4>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="space-y-1 text-xs">Status<select className={`${select} w-full`} value={status} onChange={(e) => setStatus(e.target.value as FindingStatus)}>{FINDING_STATUSES.map((s) => <option key={s} value={s} disabled={!allowed.includes(s)}>{FINDING_STATUS_LABELS[s]}{allowed.includes(s) ? "" : " (not available)"}</option>)}</select></label>
          <label className="space-y-1 text-xs">Owner<Input value={owner} onChange={(e) => setOwner(e.target.value)} maxLength={120} /></label>
          <label className="space-y-1 text-xs">Due date<Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
        </div>
        {needsRationale && <label className="block space-y-1 text-xs">Rationale (required, at least 10 characters)<Textarea rows={2} value={rationale} onChange={(e) => setRationale(e.target.value)} /></label>}
        {verifying && <label className="block space-y-1 text-xs">Manual verification notes: who verified it and how (at least 10 characters). A passing retest is the preferred route.<Textarea rows={2} value={manual} onChange={(e) => setManual(e.target.value)} /></label>}
        <label className="block space-y-1 text-xs">Notes<Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} /></label>
        {wf.verifiedAt && <p className="text-xs text-emerald-400">Verified {new Date(wf.verifiedAt).toLocaleString()} by {wf.verifiedBy} ({wf.verificationMethod}).</p>}
        {wf.retestStatus !== "none" && <p className="text-xs text-muted-foreground">Last retest: {wf.retestStatus}.</p>}
        {patch.error && <ErrorNote error={patch.error} />}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={save} disabled={patch.isPending}>{patch.isPending ? "Saving" : "Save workflow"}</Button>
          {f.kind === "defect" && <Button size="sm" variant="outline" onClick={() => onRetest(f.fingerprint)}><RefreshCw className="mr-1.5 h-4 w-4" />Retest this finding</Button>}
          <Button size="sm" variant="ghost" onClick={() => explain.mutate(f.fingerprint)} disabled={explain.isPending}><Sparkles className="mr-1.5 h-4 w-4" />{explain.isPending ? "Explaining" : "Explain"}</Button>
        </div>
        {explain.error && <ErrorNote error={explain.error} />}
        {explain.data && <div className="rounded-lg border bg-muted/30 p-3 text-xs"><div className="mb-1 font-medium">{explain.data.source === "ai" ? "AI-assisted explanation" : "Explanation"}</div><p className="whitespace-pre-wrap">{explain.data.text}</p><p className="mt-2 text-muted-foreground">{explain.data.disclaimer}</p></div>}
      </div>
    </div>
  );
}
