import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, Bot, CheckCircle2, ChevronDown, ChevronRight, Gauge, Loader2, Play, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { intel, IntelError } from "@/lib/intelligence-local";

type Sev = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFORMATIONAL";
const SEV_STYLE: Record<Sev, string> = { CRITICAL: "bg-red-600 text-white", HIGH: "bg-orange-500 text-white", MEDIUM: "bg-amber-400 text-black", LOW: "bg-sky-500 text-white", INFORMATIONAL: "bg-slate-400 text-white" };
const LEVELS = ["0 Observe", "1 Recommend", "2 Prepare", "3 Approved execution", "4 Guarded autonomy"];

const money = (v: number, cur: string) => { try { return new Intl.NumberFormat(undefined, { style: "currency", currency: cur, maximumFractionDigits: 0 }).format(v); } catch { return `${cur} ${Math.round(v).toLocaleString()}`; } };
const fmt = (k: any, v: number, cur?: string) => (k.unit === "money" && cur ? money(v, cur) : k.unit === "percent" ? `${v}%` : k.unit === "days" ? `${v}d` : v.toLocaleString());
const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString() : "-");

function useData<T>(path: string | null, query?: Record<string, string>, tick = 0) {
  const [s, set] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  const qs = JSON.stringify(query ?? {});
  useEffect(() => {
    if (!path) return;
    let live = true; set((x) => ({ ...x, loading: true }));
    intel<T>("GET", path, { query: JSON.parse(qs) }).then((data) => live && set({ data, loading: false })).catch((e) => live && set({ error: e instanceof IntelError ? e.message : "Request failed", loading: false }));
    return () => { live = false; };
  }, [path, qs, tick]);
  return s;
}

function Spark({ points }: { points: { value: number }[] }) {
  if (points.length < 2) return <div className="text-xs text-muted-foreground">Trend appears after two runs.</div>;
  const w = 160, h = 40, xs = points.map((p) => p.value), lo = Math.min(...xs, 0), hi = Math.max(...xs, 100);
  const d = points.map((p, i) => `${i ? "L" : "M"}${(i / (points.length - 1)) * w},${h - ((p.value - lo) / (hi - lo || 1)) * h}`).join(" ");
  return <svg role="img" aria-label="Health score trend" width={w} height={h} className="text-primary"><path d={d} fill="none" stroke="currentColor" strokeWidth="2" /></svg>;
}

function Overview({ tick, onRun, running }: { tick: number; onRun: () => void; running: boolean }) {
  const { data, error, loading } = useData<any>("/overview", undefined, tick);
  if (loading && !data) return <div className="p-6 flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Reading your Sales data...</div>;
  if (error) return <Card><CardContent className="p-6 text-sm text-red-600">{error}</CardContent></Card>;
  const o = data!, h = o.health, sev = o.findings.openBySeverity as Record<string, number>;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-1"><CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Gauge className="h-4 w-4" /> Business health</CardTitle></CardHeader>
          <CardContent>
            {!h ? <p className="text-sm text-muted-foreground">No analysis has run yet. Run the executive analysis to compute a score from your records.</p>
              : h.score === null ? <div><div className="text-2xl font-semibold">Withheld</div><p className="text-sm text-muted-foreground">Not enough data to score honestly ({h.reason?.replace(/_/g, " ")}, coverage {Math.round((h.coverage ?? 0) * 100)}%).</p></div>
              : <div><div className="text-4xl font-semibold">{h.score}<span className="text-base text-muted-foreground">/100</span></div><p className="text-xs text-muted-foreground">Data coverage {Math.round((h.coverage ?? 0) * 100)}% - as of {when(h.takenAt)}</p><Spark points={h.trend} /></div>}
          </CardContent></Card>
        <Card className="md:col-span-1"><CardHeader className="pb-2"><CardTitle className="text-base">Open findings</CardTitle></CardHeader>
          <CardContent><div className="flex flex-wrap gap-2">{(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFORMATIONAL"] as Sev[]).map((s) => <Badge key={s} className={cn(SEV_STYLE[s], !sev[s] && "opacity-40")}>{s} {sev[s] ?? 0}</Badge>)}</div>
            <p className="mt-2 text-xs text-muted-foreground">{o.findings.open} open. {o.findings.criticalUnresolved} critical unresolved.</p></CardContent></Card>
        <Card className="md:col-span-1"><CardHeader className="pb-2"><CardTitle className="text-base">Actions & last run</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div>{o.approvals.awaiting} awaiting approval, {o.approvals.prepared} prepared, {o.approvals.executed} executed{o.approvals.failed ? `, ${o.approvals.failed} failed` : ""}</div>
            <div className="text-xs text-muted-foreground">{o.lastRun ? `Last run ${when(o.lastRun.createdAt)}: ${o.lastRun.status}${o.lastRun.degraded ? " (degraded)" : ""}` : "No runs yet."}</div>
            <Button size="sm" onClick={onRun} disabled={running} className="mt-2">{running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}Run executive analysis</Button>
          </CardContent></Card>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {o.kpis.map((k: any) => (
          <Card key={k.key} title={`${k.definition}\nFormula: ${k.formula}\nSource: ${k.source}${k.asOf ? `\nAs of: ${when(k.asOf)}` : ""}`}>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">{k.label}{k.period ? ` - ${k.period}` : ""}</div>
              {!k.available ? <div className="mt-1 text-sm text-muted-foreground">Unavailable{k.note ? `: ${k.note}` : " - no data yet"}</div>
                : k.values ? (k.values.length ? k.values.map((v: any) => <div key={v.currency} className="text-xl font-semibold">{fmt(k, v.value, v.currency)}</div>) : <div className="text-sm text-muted-foreground">None recorded</div>)
                : <div className="text-xl font-semibold">{k.value === null ? "-" : fmt(k, k.value)}</div>}
              <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground"><span>{k.source}</span>{k.href && <Link href={k.href} className="underline">Drill down</Link>}</div>
            </CardContent>
          </Card>))}
      </div>
      {!o.aiConfigured && <p className="text-xs text-muted-foreground">Analysis here is fully deterministic and computed on this device. The optional AI narrative needs an OpenRouter key on the API server.</p>}
    </div>
  );
}

function FindingRowView({ f, onSaved }: { f: any; onSaved: () => void }) {
  const [open, setOpen] = useState(false), [status, setStatus] = useState(f.workflowStatus), [owner, setOwner] = useState(f.owner ?? ""), [due, setDue] = useState(f.dueDate ?? ""), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const save = async () => { setBusy(true); setErr(""); try { await intel("PATCH", `/findings/${f.id}`, { body: { workflowStatus: status, owner: owner || null, dueDate: due || null } }); onSaved(); } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); } finally { setBusy(false); } };
  const x = f.finding;
  return (
    <Card><CardContent className="p-4">
      <button className="flex w-full items-start gap-2 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? <ChevronDown className="mt-1 h-4 w-4 shrink-0" /> : <ChevronRight className="mt-1 h-4 w-4 shrink-0" />}
        <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><Badge className={SEV_STYLE[f.severity as Sev]}>{f.severity}</Badge><Badge variant="outline">{f.evidenceStatus.replace(/_/g, " ")}</Badge><Badge variant="secondary">{f.workflowStatus.replace(/_/g, " ")}</Badge><span className="text-xs text-muted-foreground">confidence {Math.round(x.confidence * 100)}%</span></div>
          <div className="mt-1 font-medium">{x.title}</div></div>
      </button>
      {open && <div className="mt-3 space-y-3 pl-6 text-sm">
        <p>{x.detail}</p>
        <div><div className="text-xs font-medium uppercase text-muted-foreground">Evidence</div><ul className="list-disc pl-5">{x.evidence.map((e: any, i: number) => <li key={i}><span className="font-mono text-xs">{e.source} {e.ref}</span>{e.note ? ` - ${e.note}` : ""}</li>)}</ul></div>
        <div className="grid gap-2 sm:grid-cols-4">
          <select className="h-9 rounded-md border bg-background px-2" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Workflow status">{["open", "acknowledged", "in_progress", "resolved", "dismissed"].map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}</select>
          <Input placeholder="Owner" value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Owner" maxLength={120} />
          <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date" />
          <Button size="sm" onClick={save} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}</Button>
        </div>
        {err && <p className="text-red-600">{err}</p>}
        <div><div className="text-xs font-medium uppercase text-muted-foreground">History</div><ul className="text-xs text-muted-foreground">{[...f.history].reverse().map((h: any, i: number) => <li key={i}>{when(h.at)} - {h.event.replace(/_/g, " ")} {h.detail && typeof h.detail === "object" ? JSON.stringify(h.detail) : ""}</li>)}</ul></div>
        <p className="text-xs text-muted-foreground">First seen {when(f.firstSeen)}, last seen {when(f.lastSeen)}. Success criterion: finding is no longer observed on the next reassessment.</p>
      </div>}
    </CardContent></Card>
  );
}

function Findings({ tick, bump }: { tick: number; bump: () => void }) {
  const [status, setStatus] = useState("");
  const { data, error, loading } = useData<{ findings: any[] }>("/findings", status ? { status } : undefined, tick);
  return (
    <div className="space-y-3">
      <select className="h-9 rounded-md border bg-background px-2 text-sm" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status"><option value="">All statuses</option>{["open", "acknowledged", "in_progress", "resolved", "dismissed"].map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}</select>
      {loading && !data ? <Loader2 className="h-4 w-4 animate-spin" /> : error ? <p className="text-sm text-red-600">{error}</p>
        : !data!.findings.length ? <Card><CardContent className="p-6 text-sm text-muted-foreground">No findings{status ? " with this status" : " yet"}. Run the executive analysis to evaluate your records.</CardContent></Card>
        : data!.findings.map((f) => <FindingRowView key={f.id + f.workflowStatus + f.lastSeen} f={f} onSaved={bump} />)}
    </div>
  );
}

function Plan({ tick }: { tick: number }) {
  const roots = useData<{ tasks: any[] }>("/tasks", { roots: "1", status: "succeeded" }, tick);
  const last = roots.data?.tasks.find((t) => t.agentRole === "chief_executive");
  const task = useData<{ task: any; tree: any[] }>(last ? `/tasks/${last.id}` : null, undefined, tick);
  if (roots.loading && !roots.data) return <Loader2 className="h-4 w-4 animate-spin" />;
  if (!last) return <Card><CardContent className="p-6 text-sm text-muted-foreground">No executive analysis has completed yet.</CardContent></Card>;
  const d = task.data?.task.result?.data, r = task.data?.task.result;
  if (!d) return <Loader2 className="h-4 w-4 animate-spin" />;
  return (
    <div className="space-y-3">
      {d.narrative && <Card><CardHeader><CardTitle className="text-base">Executive summary (AI-written from the figures below)</CardTitle></CardHeader><CardContent className="text-sm">{d.narrative}</CardContent></Card>}
      <Card><CardHeader><CardTitle className="text-base">Prioritised action plan</CardTitle><CardDescription>{d.plan.length} items, ranked by impact x confidence x urgency / (effort x risk). Effort and risk are rule-of-thumb estimates; owners are unassigned until you assign them on the Findings tab.</CardDescription></CardHeader>
        <CardContent className="space-y-2">{d.plan.slice(0, 25).map((p: any, i: number) => (
          <div key={p.findingId} className="rounded-md border p-3 text-sm"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs">#{i + 1}</span><Badge className={SEV_STYLE[p.severity as Sev]}>{p.severity}</Badge><span className="font-medium">{p.title}</span><span className="ml-auto text-xs text-muted-foreground">score {p.score}</span></div>
            <div className="mt-1 text-xs text-muted-foreground">impact {p.inputs.impact} - confidence {Math.round(p.inputs.confidence * 100)}% - urgency {p.inputs.urgency} - effort {p.inputs.effort} - risk {p.inputs.risk}{p.dependsOn?.length ? ` - depends on: ${p.dependsOn.join("; ")}` : ""}</div></div>))}
          {!d.plan.length && <p className="text-sm text-muted-foreground">No findings: nothing to prioritise.</p>}</CardContent></Card>
      {r?.uncertainties?.length > 0 && <Card><CardHeader><CardTitle className="text-base">Limitations & uncertainties</CardTitle></CardHeader><CardContent><ul className="list-disc pl-5 text-sm text-muted-foreground">{r.uncertainties.slice(0, 20).map((u: string, i: number) => <li key={i}>{u}</li>)}</ul></CardContent></Card>}
    </div>
  );
}

function Agents({ tick }: { tick: number }) {
  const agents = useData<{ agents: any[] }>("/agents");
  const runs = useData<{ tasks: any[] }>("/tasks", { roots: "1" }, tick);
  const last = runs.data?.tasks[0];
  const tree = useData<{ tree: any[] }>(last ? `/tasks/${last.id}` : null, undefined, tick);
  return (
    <div className="space-y-4">
      {last && <Card><CardHeader><CardTitle className="text-base">Latest run timeline</CardTitle><CardDescription>{last.agentRole} - {last.status}{last.degraded ? " (degraded: some inputs unavailable)" : ""} - {when(last.createdAt)}</CardDescription></CardHeader>
        <CardContent className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1">Agent</th><th>Status</th><th>Findings</th><th>Confidence</th><th>Summary</th></tr></thead>
          <tbody>{(tree.data?.tree ?? []).map((t) => <tr key={t.id} className="border-t"><td className="py-1 font-mono text-xs">{t.agentRole}</td><td>{t.status}{t.degraded ? " (degraded)" : ""}</td><td>{t.findings}</td><td>{t.confidence === null ? "-" : `${Math.round(t.confidence * 100)}%`}</td><td className="text-muted-foreground">{t.error ?? t.summary}</td></tr>)}</tbody></table></CardContent></Card>}
      {agents.loading && !agents.data && <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><Loader2 className="h-4 w-4 animate-spin" />Loading agents</p>}
      {agents.error && <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">The agent list could not be loaded: {agents.error}</p>}
      {agents.data && !agents.data.agents.length && <p className="text-sm text-muted-foreground">No agents are registered.</p>}
      <div className="grid gap-3 md:grid-cols-2">{agents.data?.agents.map((a) => (
        <Card key={a.role}><CardContent className="p-4 text-sm"><div className="flex items-center gap-2"><Bot className="h-4 w-4" /><span className="font-medium">{a.title}</span><Badge variant="outline" className="ml-auto">max level {a.autonomyCeiling}</Badge></div>
          <p className="mt-1 text-muted-foreground">{a.description}</p><p className="mt-1 text-xs">Tools: {a.tools.length ? a.tools.join(", ") : "none (coordinates other agents)"}</p></CardContent></Card>))}</div>
    </div>
  );
}

function Approvals({ tick, bump }: { tick: number; bump: () => void }) {
  const { data, error, loading } = useData<{ approvals: any[] }>("/approvals", undefined, tick);
  const [busy, setBusy] = useState(""), [err, setErr] = useState("");
  const act = async (id: string, kind: "promote" | "approve" | "reject") => { setBusy(id); setErr(""); try { await intel("POST", `/approvals/${id}/${kind === "promote" ? "promote" : "decide"}`, { body: kind === "promote" ? {} : { decision: kind } }); bump(); } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); } finally { setBusy(""); } };
  if (loading && !data) return <Loader2 className="h-4 w-4 animate-spin" />;
  if (error) return <p className="text-sm text-red-600">{error}</p>;
  return (
    <div className="space-y-2">{err && <p className="text-sm text-red-600">{err}</p>}
      {!data!.approvals.length && <Card><CardContent className="p-6 text-sm text-muted-foreground">No proposed actions yet. Agents propose follow-up tasks when they find neglected leads or stalled deals.</CardContent></Card>}
      {data!.approvals.map((a) => (
        <Card key={a.id}><CardContent className="p-4 text-sm"><div className="flex flex-wrap items-center gap-2"><Badge variant="secondary">{a.status}</Badge><Badge variant="outline">risk {a.action.risk}</Badge><span className="font-medium">{a.action.summary}</span></div>
          <div className="mt-1 text-xs text-muted-foreground">Proposed by {a.requestedBy} on {when(a.requestedAt)}{a.decidedBy ? ` - decided by ${a.decidedBy} on ${when(a.decidedAt)}` : ""}{a.executionResult ? ` - result: ${a.executionResult.ok ? "ok" : "failed"} (${a.executionResult.detail})` : ""}</div>
          <div className="mt-2 flex gap-2">
            {a.status === "prepared" && <Button size="sm" variant="outline" disabled={busy === a.id} onClick={() => act(a.id, "promote")}>Request approval</Button>}
            {a.status === "pending" && <><Button size="sm" disabled={busy === a.id} onClick={() => act(a.id, "approve")}><CheckCircle2 className="mr-1 h-4 w-4" />Approve</Button><Button size="sm" variant="outline" disabled={busy === a.id} onClick={() => act(a.id, "reject")}><XCircle className="mr-1 h-4 w-4" />Reject</Button></>}
          </div></CardContent></Card>))}</div>
  );
}

function Audit({ tick }: { tick: number }) {
  const { data, error, loading } = useData<any>("/audit", { limit: "100" }, tick);
  if (loading && !data) return <Loader2 className="h-4 w-4 animate-spin" />;
  if (error) return <p className="text-sm text-red-600">{error}</p>;
  return (
    <div className="space-y-3"><div className="flex items-center gap-2 text-sm">{data.valid ? <><ShieldCheck className="h-4 w-4 text-green-600" /> Audit chain verified ({data.total} events)</> : <><AlertTriangle className="h-4 w-4 text-red-600" /> Audit chain FAILED verification</>}</div>
      <Card><CardContent className="overflow-x-auto p-4"><table className="w-full text-sm"><thead><tr className="text-left text-xs text-muted-foreground"><th>When</th><th>Actor</th><th>Action</th><th>Resource</th></tr></thead>
        <tbody>{data.events.map((e: any) => <tr key={e.id} className="border-t"><td className="py-1 whitespace-nowrap">{when(e.at)}</td><td className="font-mono text-xs">{e.actor}</td><td>{e.action}</td><td className="font-mono text-xs">{e.resource} {e.resourceId}</td></tr>)}</tbody></table>
        {!data.events.length && <p className="text-sm text-muted-foreground">No events yet.</p>}</CardContent></Card></div>
  );
}

function SettingsTab({ tick, bump }: { tick: number; bump: () => void }) {
  const { data, error, loading } = useData<any>("/settings", undefined, tick);
  const [s, setS] = useState<any>(null), [msg, setMsg] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => { if (data) setS(structuredClone(data.settings)); }, [data]);
  if (loading && !s) return <Loader2 className="h-4 w-4 animate-spin" />;
  if (error || !s) return <p className="text-sm text-red-600">{error}</p>;
  const save = async () => { setBusy(true); setMsg(""); try { await intel("PUT", "/settings", { body: s }); setMsg("Saved."); bump(); } catch (e) { setMsg(e instanceof Error ? e.message : "Failed"); } finally { setBusy(false); } };
  return (
    <div className="space-y-4">
      <Card><CardHeader><CardTitle className="text-base">Autonomy</CardTitle><CardDescription>How far agents may go. Level 2 prepares actions for you; nothing executes without approval unless you raise the level. These always need a human, whatever the level: {data.mandatoryApprovalTypes.join(", ")}.</CardDescription></CardHeader>
        <CardContent><select className="h-9 rounded-md border bg-background px-2 text-sm" value={s.autonomy.defaultLevel} onChange={(e) => setS({ ...s, autonomy: { ...s.autonomy, defaultLevel: Number(e.target.value) } })} aria-label="Default autonomy level">{LEVELS.map((l, i) => <option key={l} value={i}>{l}</option>)}</select></CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">Health score weights</CardTitle><CardDescription>Relative importance of each domain (0 to 1). They are re-normalised over the domains that have data.</CardDescription></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-4">{(["sales", "financial", "operations", "data"] as const).map((k) => <label key={k} className="text-sm capitalize">{k === "data" ? "data reliability" : k}<Input type="number" min={0} max={1} step={0.05} value={s.weights[k]} onChange={(e) => setS({ ...s, weights: { ...s.weights, [k]: Number(e.target.value) } })} /></label>)}</CardContent></Card>
      <div className="flex items-center gap-3"><Button onClick={save} disabled={busy}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Save settings</Button>{msg && <span className="text-sm text-muted-foreground">{msg}</span>}</div>
    </div>
  );
}

export default function IntelligencePage() {
  const [tick, setTick] = useState(0), [running, setRunning] = useState(false), [err, setErr] = useState("");
  const bump = useCallback(() => setTick((t) => t + 1), []);
  const run = async () => {
    setRunning(true); setErr("");
    try { await intel("POST", "/runs", { body: {} }); } catch (e) { setErr(e instanceof Error ? e.message : "Run failed"); } finally { setRunning(false); bump(); }
  };
  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-3"><div><h1 className="text-2xl font-semibold">Intelligence Command Centre</h1><p className="text-sm text-muted-foreground">Agents read your real Sales records, show their evidence, and only act with your approval.</p></div>
        <Button variant="outline" size="sm" className="ml-auto" onClick={bump}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button></div>
      {err && <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">{err}</p>}
      <Tabs defaultValue="overview">
        <TabsList className="flex h-auto flex-wrap justify-start">{["overview", "findings", "plan", "agents", "approvals", "audit", "settings"].map((t) => <TabsTrigger key={t} value={t} className="capitalize">{t}</TabsTrigger>)}</TabsList>
        <TabsContent value="overview"><Overview tick={tick} onRun={run} running={running} /></TabsContent>
        <TabsContent value="findings"><Findings tick={tick} bump={bump} /></TabsContent>
        <TabsContent value="plan"><Plan tick={tick} /></TabsContent>
        <TabsContent value="agents"><Agents tick={tick} /></TabsContent>
        <TabsContent value="approvals"><Approvals tick={tick} bump={bump} /></TabsContent>
        <TabsContent value="audit"><Audit tick={tick} /></TabsContent>
        <TabsContent value="settings"><SettingsTab tick={tick} bump={bump} /></TabsContent>
      </Tabs>
    </div>
  );
}
