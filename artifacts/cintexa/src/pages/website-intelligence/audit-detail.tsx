import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Ban, FileJson, FileSpreadsheet, ShieldCheck, CheckCircle2, CircleDashed, Download, FileText, ListChecks, Loader2, RefreshCw, RotateCcw, Share2, Trash2, XCircle } from "lucide-react";
import type { AuditBundle, AuditSummary, Severity } from "@workspace/wi-core";
import { CATEGORY_SHORT_LABELS, STAGE_LABELS } from "@workspace/wi-core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  downloadExport, isActive, useAudit, useGate, useAuditAction, useBenchmarkStart, useBenchmarks, useBundle, useComparison, useEvents, useRetest, useShare, useShareMutations, useTrend,
} from "@/lib/website-intelligence/api";
import {
  AuditStatusBadge, CategoryBars, CategoryRadar, EmptyState, ErrorNote, Loading, Panel, ScoreRing, SeverityBadge, SeverityChart, Stat, WI, fmtDate, label, pct, scoreColor,
} from "./components";

type Tab = "dashboard" | "pages" | "performance" | "compare" | "benchmarks" | "log";

export default function AuditDetail({ id }: { id: string }) {
  const audit = useAudit(id);
  const [tab, setTab] = useState<Tab>("dashboard");
  const [, nav] = useLocation();
  const actions = useAuditAction(id);
  const retest = useRetest(id);
  const a = audit.data;
  const active = isActive(a?.status);
  const finished = a?.status === "completed" || a?.status === "partial";
  const bundle = useBundle(id, finished);

  if (audit.isLoading) return <Loading />;
  if (audit.error) return <ErrorNote error={audit.error} />;
  if (!a) return null;

  const tabs: { id: Tab; label: string; show: boolean }[] = [
    { id: "dashboard", label: "Dashboard", show: finished },
    { id: "pages", label: "Pages", show: finished },
    { id: "performance", label: "Performance", show: finished },
    { id: "compare", label: "Compare", show: finished },
    { id: "benchmarks", label: "Benchmarks", show: finished && a.kind === "audit" },
    { id: "log", label: "Execution log", show: true },
  ];
  const current: Tab = tabs.find((t) => t.id === tab && t.show)?.id ?? (finished ? "dashboard" : "log");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><h2 className="truncate text-lg font-semibold">{a.config.name || a.hostname}</h2><AuditStatusBadge s={a.status} />{a.kind !== "audit" && <span className="rounded border px-1.5 text-xs">{a.kind}</span>}</div>
          <a href={a.url} target="_blank" rel="noopener noreferrer" className="break-all text-xs text-muted-foreground underline">{a.url}</a>
          <div className="text-xs text-muted-foreground">{label(a.profile)} profile - started {fmtDate(a.startedAt ?? a.createdAt)}{a.completedAt ? ` - finished ${fmtDate(a.completedAt)}` : ""}</div>
        </div>
        <div className="wi-no-print flex flex-wrap gap-2">
          {active && <Button variant="outline" size="sm" onClick={() => actions.cancel.mutate()} disabled={actions.cancel.isPending}><Ban className="mr-1.5 h-4 w-4" />Cancel</Button>}
          {["failed", "cancelled", "partial"].includes(a.status) && <Button variant="outline" size="sm" onClick={() => actions.retry.mutate()} disabled={actions.retry.isPending}><RotateCcw className="mr-1.5 h-4 w-4" />Retry</Button>}
          {finished && <>
            <Link href={`${WI}/audits/${id}/findings`}><Button variant="outline" size="sm"><ListChecks className="mr-1.5 h-4 w-4" />Findings</Button></Link>
            <Link href={`${WI}/audits/${id}/recommendations`}><Button variant="outline" size="sm"><FileText className="mr-1.5 h-4 w-4" />Recommendations</Button></Link>
            <Link href={`${WI}/audits/${id}/report`}><Button size="sm"><Download className="mr-1.5 h-4 w-4" />Report</Button></Link>
          </>}
          {!active && <Button variant="ghost" size="sm" onClick={() => { if (window.confirm("Delete this audit? You can ask an administrator to restore it until it is purged.")) actions.remove.mutate(false, { onSuccess: () => nav(`${WI}/audits`) }); }}><Trash2 className="h-4 w-4" /></Button>}
        </div>
      </div>
      {[actions.cancel, actions.retry, actions.remove, retest].map((m, i) => (m.error ? <ErrorNote key={i} error={m.error} /> : null))}
      {a.error && <ErrorNote error={new Error(a.error)} />}

      <div role="tablist" aria-label="Audit views" className="wi-no-print flex flex-wrap gap-1 border-b">
        {tabs.filter((t) => t.show).map((t) => (
          <button key={t.id} role="tab" aria-selected={current === t.id} onClick={() => setTab(t.id)} className={cn("-mb-px border-b-2 px-3 py-2 text-sm", current === t.id ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}>{t.label}</button>
        ))}
      </div>

      {current === "log" && <ExecutionCenter audit={a} />}
      {finished && current === "dashboard" && (bundle.isLoading ? <Loading /> : bundle.error ? <ErrorNote error={bundle.error} /> : bundle.data && <Dashboard bundle={bundle.data} onRetest={(fps) => retest.mutate(fps, { onSuccess: (r) => nav(`${WI}/audits/${r.id}`) })} />)}
      {finished && current === "pages" && bundle.data && <PagesView bundle={bundle.data} />}
      {finished && current === "performance" && bundle.data && <PerformanceView bundle={bundle.data} />}
      {finished && current === "compare" && <CompareView id={id} hostname={a.hostname} />}
      {finished && current === "benchmarks" && <BenchmarksView id={id} />}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ execution center

function ExecutionCenter({ audit }: { audit: AuditSummary }) {
  const active = isActive(audit.status);
  const ev = useEvents(audit.id, active);
  const [level, setLevel] = useState("");
  const data = ev.data;
  const stages = data?.stages ?? audit.stages;
  const progress = data?.progress ?? audit.progress;
  const events = (data?.events ?? []).filter((e) => !level || e.level === level);
  const icon = (s: string) => s === "completed" ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : s === "running" ? <Loader2 className="h-4 w-4 animate-spin text-sky-400" /> : s === "failed" ? <XCircle className="h-4 w-4 text-red-400" /> : s === "skipped" ? <CircleDashed className="h-4 w-4 text-slate-400" /> : s === "cancelled" ? <Ban className="h-4 w-4 text-slate-400" /> : <CircleDashed className="h-4 w-4 text-muted-foreground/50" />;
  const done = stages.filter((s) => ["completed", "skipped", "failed", "cancelled"].includes(s.status)).length;
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Panel title="Stages" description={`${done} of ${stages.length} stages settled. Status comes from the job itself, not a timer.`} className="lg:col-span-1">
        <ol className="space-y-2" aria-live="polite">
          {stages.map((s) => (
            <li key={s.id} className="flex items-start gap-2 text-sm">{icon(s.status)}<div><div className={cn(s.status === "pending" && "text-muted-foreground")}>{STAGE_LABELS[s.id]}</div>{(s.note || s.error) && <div className={cn("text-xs", s.error ? "text-red-400" : "text-muted-foreground")}>{s.error ?? s.note}</div>}</div></li>
          ))}
        </ol>
        <dl className="mt-4 grid grid-cols-3 gap-2 border-t pt-3 text-center text-xs">
          {[["Discovered", progress.discovered], ["Inspected", progress.inspected], ["Failed", progress.failed], ["Skipped", progress.skipped], ["Findings", progress.findings], ["Requests", progress.requests]].map(([k, v]) => (
            <div key={String(k)}><dt className="text-muted-foreground">{k}</dt><dd className="text-base font-semibold tabular-nums">{v}</dd></div>
          ))}
        </dl>
      </Panel>
      <Panel className="lg:col-span-2" title="Event log" description="Every message is written by the engine as it works." actions={<select className="h-8 rounded-md border bg-background px-2 text-xs" value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Filter log level"><option value="">All levels</option><option value="info">Info</option><option value="warn">Warnings</option><option value="error">Errors</option></select>}>
        {ev.isLoading ? <Loading /> : ev.error ? <ErrorNote error={ev.error} /> : !events.length ? <p className="text-sm text-muted-foreground">No events yet.</p> : (
          <ol className="max-h-[32rem] space-y-1 overflow-auto font-mono text-xs">
            {events.map((e) => (
              <li key={e.id} className={cn("flex gap-2", e.level === "error" && "text-red-400", e.level === "warn" && "text-amber-400")}>
                <span className="shrink-0 text-muted-foreground">{new Date(e.at).toLocaleTimeString()}</span>
                {e.stage && <span className="shrink-0 text-muted-foreground">[{e.stage}]</span>}
                <span className="break-words">{e.message}</span>
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ dashboard

function Dashboard({ bundle, onRetest }: { bundle: AuditBundle; onRetest: (fps: string[]) => void }) {
  const { audit, findings } = bundle;
  const s = audit.scores;
  const [sev, setSev] = useState<Severity | null>(null);
  const [cat, setCat] = useState<string | null>(null);
  const trend = useTrend(audit.kind === "audit" ? audit.hostname : undefined);
  const share = useShare(audit.id);
  const shareMut = useShareMutations(audit.id);
  const [, nav] = useLocation();
  const data = useMemo(() => (s?.categories ?? []).map((c) => ({ id: c.category, label: CATEGORY_SHORT_LABELS[c.category], score: c.score, coverage: c.coverage })), [s]);
  if (!s) return <EmptyState title="No scores recorded" body="This audit finished without scoring. Check the execution log for the stage that failed." />;

  const defects = findings.filter((f) => f.kind === "defect");
  const filtered = defects.filter((f) => (!sev || f.severity === sev) && (!cat || f.category === cat)).slice(0, 8);
  const goFindings = () => nav(`${WI}/audits/${audit.id}/findings?${[sev && `severity=${sev}`, cat && `category=${cat}`].filter(Boolean).join("&")}`);
  const cov = audit.coverage;
  const immediate = defects.filter((f) => f.horizon === "immediate").map((f) => f.fingerprint);

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-3">
        <Panel title="Overall" className="lg:col-span-1">
          <div className="flex items-center gap-5">
            <ScoreRing score={s.overall} size={132} caption="Overall score" provisional={s.provisional} />
            <div className="space-y-1 text-sm">
              <div className="font-semibold">{s.band ?? "No band available"}</div>
              <div className="rounded-md border px-2 py-1 text-xs" style={{ borderColor: scoreColor(s.overall) }}>{s.readiness.label}</div>
              <div className="text-xs text-muted-foreground">Coverage {pct(s.coverage)}</div>
            </div>
          </div>
          {s.provisional && <p className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-300">Provisional: not enough applicable tests produced a result. Blocked, inconclusive and not-tested checks are never counted as passes.</p>}
          {s.readiness.reasons.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-4 text-xs text-muted-foreground">{s.readiness.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
        </Panel>
        <Panel title="Category radar" description="Click a category bar to filter findings below." className="lg:col-span-2">
          <div className="grid gap-4 md:grid-cols-2">
            <CategoryRadar data={data} onSelect={(c) => setCat(cat === c ? null : c)} />
            <CategoryBars data={data} active={cat} onSelect={(c) => setCat(cat === c ? null : c)} />
          </div>
        </Panel>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <Stat title="Defects" value={defects.length} hint={`${s.severityCounts.critical} critical, ${s.severityCounts.high} high`} tone={s.severityCounts.critical ? "text-red-400" : undefined} />
        <Stat title="Passed tests" value={s.counts.passed} hint={`of ${s.counts.passed + s.counts.failed + s.counts.warning} completed`} />
        <Stat title="Could not test" value={s.counts.not_tested + s.counts.blocked + s.counts.inconclusive} hint="not tested, blocked or inconclusive" />
        <Stat title="Pages inspected" value={audit.progress.inspected} hint={cov ? `${cov.discovered} discovered` : undefined} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Severity distribution" description="Counts of tests that failed or warned. Click to filter."><SeverityChart counts={s.severityCounts} active={sev} onSelect={(x) => setSev(sev === x ? null : x)} /></Panel>
        <Panel title={sev || cat ? "Filtered findings" : "Critical and high findings"} actions={<Button size="sm" variant="outline" onClick={goFindings}>Open in findings explorer</Button>}>
          {(() => {
            const list = sev || cat ? filtered : defects.filter((f) => f.severity === "critical" || f.severity === "high").slice(0, 8);
            if (!list.length) return <p className="text-sm text-muted-foreground">No matching defects. This reflects tested results only.</p>;
            return <ul className="divide-y">{list.map((f) => <li key={f.id} className="flex items-start gap-2 py-2 text-sm"><SeverityBadge s={f.severity} /><div className="min-w-0"><div>{f.title}</div><div className="text-xs text-muted-foreground">{f.affectedCount} affected - {label(f.workflow.status)}</div></div></li>)}</ul>;
          })()}
        </Panel>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Audit coverage" description="What was and was not inspected.">
          {cov ? (
            <dl className="grid grid-cols-2 gap-2 text-sm">
              {[["Inspected", cov.inspected], ["Discovered", cov.discovered], ["Failed to load", cov.failed], ["Blocked by robots.txt", cov.skippedRobots], ["Out of scope", cov.skippedScope], ["Skipped by limits", cov.skippedLimit], ["Depth reached", `${cov.depthReached} / ${cov.maxDepth}`], ["Sitemap URLs", cov.sitemapUrls]].map(([k, v]) => <div key={String(k)} className="flex justify-between border-b py-1"><dt className="text-muted-foreground">{k}</dt><dd className="tabular-nums">{v}</dd></div>)}
            </dl>
          ) : <p className="text-sm text-muted-foreground">Coverage was not recorded.</p>}
          {cov?.limitHit && <p className="mt-2 text-xs text-amber-300">The {cov.limitHit} limit stopped the crawl; the sample may not represent the whole site.</p>}
        </Panel>
        <Panel title="Score history" description="Finished audits of this host. Scores from different scoring versions are not strictly comparable.">
          {trend.isLoading ? <Loading /> : (trend.data?.points.length ?? 0) < 2 ? <p className="text-sm text-muted-foreground">History appears after a second audit of this site.</p> : (
            <>
              <div className="h-44" aria-hidden="true"><ResponsiveContainer><LineChart data={trend.data!.points.map((p) => ({ at: p.at ? new Date(p.at).toLocaleDateString() : "", overall: p.overall }))}><CartesianGrid strokeOpacity={0.15} /><XAxis dataKey="at" tick={{ fontSize: 10 }} /><YAxis domain={[0, 100]} tick={{ fontSize: 10 }} /><Tooltip /><Line type="monotone" dataKey="overall" stroke="#b08612" strokeWidth={2} dot /></LineChart></ResponsiveContainer></div>
              <table className="sr-only"><caption>Overall score by audit date</caption><tbody>{trend.data!.points.map((p) => <tr key={p.id}><th scope="row">{p.at ?? "unknown"}</th><td>{p.overall ?? "not scored"}</td></tr>)}</tbody></table>
            </>
          )}
        </Panel>
      </div>

      {bundle.previous && (
        <Panel title="Change since the previous audit">
          <p className="text-sm">Previous overall: <b>{bundle.previous.overall == null ? "n/a" : Math.round(bundle.previous.overall)}</b>{bundle.comparison?.overallDelta != null && <> - change <b className={bundle.comparison.overallDelta >= 0 ? "text-emerald-400" : "text-red-400"}>{bundle.comparison.overallDelta > 0 ? "+" : ""}{Math.round(bundle.comparison.overallDelta * 10) / 10}</b></>}. See the Compare tab for details.</p>
        </Panel>
      )}

      <ExportAndGate id={bundle.audit.id} />

      <Panel title="Next steps" className="wi-no-print">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" disabled={!immediate.length} onClick={() => onRetest(immediate)}><RefreshCw className="mr-1.5 h-4 w-4" />Retest immediate fixes ({immediate.length})</Button>
          {share.data?.shared ? (
            <><Button size="sm" variant="outline" onClick={() => navigator.clipboard?.writeText(`${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, "")}${WI}/shared/${share.data?.token}`)}><Share2 className="mr-1.5 h-4 w-4" />Copy client link</Button><Button size="sm" variant="ghost" onClick={() => shareMut.revoke.mutate()}>Revoke link</Button></>
          ) : <Button size="sm" variant="outline" onClick={() => shareMut.create.mutate()} disabled={shareMut.create.isPending}><Share2 className="mr-1.5 h-4 w-4" />Create read-only client link</Button>}
        </div>
        {shareMut.create.error && <div className="mt-2"><ErrorNote error={shareMut.create.error} /></div>}
        {shareMut.create.data && <p className="mt-2 text-xs text-muted-foreground">{shareMut.create.data.note}</p>}
      </Panel>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ pages

function PagesView({ bundle }: { bundle: AuditBundle }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"score" | "url" | "ttfb">("score");
  const rows = useMemo(() => bundle.pages.filter((p) => p.facts.url.toLowerCase().includes(q.toLowerCase())).sort((a, b) => sort === "url" ? a.facts.url.localeCompare(b.facts.url) : sort === "ttfb" ? (b.facts.ttfbMs ?? 0) - (a.facts.ttfbMs ?? 0) : (a.score ?? 101) - (b.score ?? 101)), [bundle, q, sort]);
  const defectsByUrl = useMemo(() => { const m = new Map<string, number>(); for (const f of bundle.findings.filter((x) => x.kind === "defect")) for (const u of f.affectedUrls) m.set(u, (m.get(u) ?? 0) + 1); return m; }, [bundle]);
  if (!bundle.pages.length) return <EmptyState title="No pages were inspected" body="The crawl did not reach any page. See the execution log." />;
  return (
    <div className="space-y-3">
      <div className="wi-no-print flex flex-wrap gap-2"><Input className="max-w-xs" placeholder="Filter URLs" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter pages" /><select className="h-9 rounded-md border bg-background px-2 text-sm" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort pages"><option value="score">Lowest score first</option><option value="ttfb">Slowest response first</option><option value="url">URL</option></select></div>
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm"><thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="p-2">URL</th><th className="p-2">HTTP</th><th className="p-2">Title</th><th className="p-2">Words</th><th className="p-2">TTFB</th><th className="p-2">Issues</th><th className="p-2">Score</th></tr></thead>
          <tbody className="divide-y">{rows.slice(0, 300).map((p) => <tr key={p.facts.url}><td className="max-w-[24rem] break-all p-2"><a href={p.facts.url} target="_blank" rel="noopener noreferrer" className="underline">{p.facts.url}</a>{p.facts.important && <span className="ml-1 rounded bg-primary/15 px-1 text-[10px] text-primary">key</span>}</td><td className="p-2">{p.facts.status ?? "-"}</td><td className="p-2">{p.facts.title ? `${p.facts.titleLength} chars` : <span className="text-red-400">missing</span>}</td><td className="p-2 tabular-nums">{p.facts.wordCount}</td><td className="p-2 tabular-nums">{p.facts.ttfbMs == null ? "n/a" : `${Math.round(p.facts.ttfbMs)} ms`}</td><td className="p-2 tabular-nums">{defectsByUrl.get(p.facts.url) ?? 0}</td><td className="p-2 font-semibold tabular-nums" style={{ color: scoreColor(p.score) }}>{p.score == null ? "n/a" : Math.round(p.score)}</td></tr>)}</tbody>
        </table>
      </div>
      {rows.length > 300 && <p className="text-xs text-muted-foreground">Showing 300 of {rows.length}. Narrow the filter to see the rest.</p>}
    </div>
  );
}

const THRESH: Record<string, [number, number]> = { lcpMs: [2500, 4000], inpMs: [200, 500], cls: [0.1, 0.25], fcpMs: [1800, 3000], tbtMs: [200, 600], ttfbMs: [800, 1800] };
const NAMES: Record<string, string> = { lcpMs: "LCP", inpMs: "INP", cls: "CLS", fcpMs: "FCP", tbtMs: "TBT", ttfbMs: "TTFB", speedIndexMs: "Speed Index" };

function Metric({ k, v }: { k: string; v?: number }) {
  if (v == null) return null;
  const t = THRESH[k];
  const rating = !t ? "n/a" : v <= t[0] ? "good" : v <= t[1] ? "needs improvement" : "poor";
  const color = rating === "good" ? "text-emerald-400" : rating === "poor" ? "text-red-400" : rating === "needs improvement" ? "text-amber-400" : "";
  return <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">{NAMES[k] ?? k}</div><div className={cn("text-lg font-semibold tabular-nums", color)}>{k === "cls" ? v.toFixed(3) : v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`}</div><div className={cn("text-xs capitalize", color)}>{rating}</div></div>;
}

function PerformanceView({ bundle }: { bundle: AuditBundle }) {
  if (!bundle.performance.length) return <EmptyState title="No performance samples" body="Performance measurement did not run or produced no samples for this audit." />;
  return (
    <div className="space-y-5">
      <p className="rounded-lg border bg-card p-3 text-xs text-muted-foreground">Lab data is one synthetic run under fixed conditions. Field data is real-user Chrome UX Report data and exists only for sites with enough traffic. They are shown separately and never blended.</p>
      {bundle.performance.map((p, i) => (
        <Panel key={i} title={`${label(p.device)} - ${p.source === "pagespeed" ? "PageSpeed Insights" : "HTTP timing"}`} description={p.url}>
          {!p.available ? <p className="text-sm text-amber-300">Not available: {p.reason ?? "no reason recorded"}</p> : (
            <div className="space-y-4">
              {p.lab && <div><h4 className="mb-2 text-sm font-medium">Lab data{p.lab.performanceScore != null ? ` - Lighthouse score ${Math.round(p.lab.performanceScore)}` : ""}</h4><div className="grid grid-cols-2 gap-2 md:grid-cols-5">{(["lcpMs", "fcpMs", "tbtMs", "cls", "ttfbMs", "speedIndexMs"] as const).map((k) => <Metric key={k} k={k} v={p.lab?.[k]} />)}</div></div>}
              <div><h4 className="mb-2 text-sm font-medium">Field data (real users){p.field ? ` - ${p.field.origin ? "origin" : "URL"}${p.field.category ? `, ${p.field.category}` : ""}` : ""}</h4>{p.field ? <div className="grid grid-cols-2 gap-2 md:grid-cols-5">{(["lcpMs", "inpMs", "cls", "fcpMs", "ttfbMs"] as const).map((k) => <Metric key={k} k={k} v={p.field?.[k]} />)}</div> : <p className="text-sm text-muted-foreground">Not available for this URL (not enough real-user data, or the integration is not configured).</p>}</div>
            </div>
          )}
        </Panel>
      ))}
    </div>
  );
}

function CompareView({ id, hostname }: { id: string; hostname: string }) {
  const [against, setAgainst] = useState("");
  const list = useAuditsForHost(hostname);
  const c = useComparison(id, against || undefined);
  const cmp = c.data?.comparison;
  return (
    <div className="space-y-4">
      <div className="wi-no-print flex items-center gap-2 text-sm"><label htmlFor="against">Compare with</label>
        <select id="against" className="h-9 rounded-md border bg-background px-2 text-sm" value={against} onChange={(e) => setAgainst(e.target.value)}><option value="">Previous audit</option>{list.filter((x) => x.id !== id).map((x) => <option key={x.id} value={x.id}>{fmtDate(x.completedAt ?? x.createdAt)} ({x.scores?.overall == null ? "n/a" : Math.round(x.scores.overall)})</option>)}</select></div>
      {c.isLoading ? <Loading /> : c.error ? <ErrorNote error={c.error} /> : !cmp ? <EmptyState title="Nothing to compare" body={c.data?.reason ?? "There is no earlier audit of this site."} /> : (
        <>
          {cmp.scoringVersionMismatch && <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-300">Different scoring versions ({cmp.scoringVersionPrevious} vs {cmp.scoringVersionCurrent}). Score changes may reflect the method rather than the site.</p>}
          {cmp.environmentNote && <p className="text-xs text-muted-foreground">{cmp.environmentNote}</p>}
          <div className="grid gap-3 md:grid-cols-4"><Stat title="Overall change" value={cmp.overallDelta == null ? "n/a" : `${cmp.overallDelta > 0 ? "+" : ""}${Math.round(cmp.overallDelta * 10) / 10}`} tone={cmp.overallDelta == null ? undefined : cmp.overallDelta >= 0 ? "text-emerald-400" : "text-red-400"} /><Stat title="Resolved" value={cmp.resolvedFindings.length} /><Stat title="New" value={cmp.newFindings.length} /><Stat title="Recurring" value={cmp.recurringFindings.length} /></div>
          <Panel title="Category changes"><table className="w-full text-sm"><thead className="text-left text-xs uppercase text-muted-foreground"><tr><th className="py-1">Category</th><th>Before</th><th>Now</th><th>Change</th></tr></thead><tbody className="divide-y">{cmp.categoryDeltas.map((r) => <tr key={r.category}><td className="py-1.5">{r.label}</td><td className="tabular-nums">{r.previous == null ? "n/a" : Math.round(r.previous)}</td><td className="tabular-nums">{r.current == null ? "n/a" : Math.round(r.current)}</td><td className={cn("tabular-nums", (r.delta ?? 0) > 0 && "text-emerald-400", (r.delta ?? 0) < 0 && "text-red-400")}>{r.delta == null ? "n/a" : `${r.delta > 0 ? "+" : ""}${Math.round(r.delta * 10) / 10}`}</td></tr>)}</tbody></table></Panel>
          <div className="grid gap-5 md:grid-cols-2">
            <Panel title="Regressions">{cmp.regressions.length ? <ul className="space-y-1 text-sm">{cmp.regressions.map((r, i) => <li key={i}>{r.label}: {r.previous} to <b className="text-red-400">{r.current}</b></li>)}</ul> : <p className="text-sm text-muted-foreground">None detected.</p>}</Panel>
            <Panel title="Improvements">{cmp.improvements.length ? <ul className="space-y-1 text-sm">{cmp.improvements.map((r, i) => <li key={i}>{r.label}: {r.previous} to <b className="text-emerald-400">{r.current}</b></li>)}</ul> : <p className="text-sm text-muted-foreground">None detected.</p>}</Panel>
            <Panel title="New findings">{cmp.newFindings.length ? <ul className="space-y-1 text-sm">{cmp.newFindings.slice(0, 20).map((f) => <li key={f.fingerprint} className="flex gap-2"><SeverityBadge s={f.severity} />{f.title}</li>)}</ul> : <p className="text-sm text-muted-foreground">None.</p>}</Panel>
            <Panel title="Resolved findings">{cmp.resolvedFindings.length ? <ul className="space-y-1 text-sm">{cmp.resolvedFindings.slice(0, 20).map((f) => <li key={f.fingerprint} className="flex gap-2"><SeverityBadge s={f.severity} />{f.title}</li>)}</ul> : <p className="text-sm text-muted-foreground">None.</p>}</Panel>
          </div>
          <p className="text-xs text-muted-foreground">Pages added {cmp.pagesAdded.length}, removed {cmp.pagesRemoved.length}. Broken links {cmp.brokenLinks.previous} to {cmp.brokenLinks.current}.</p>
        </>
      )}
    </div>
  );
}

import { useAudits } from "@/lib/website-intelligence/api";
function useAuditsForHost(hostname: string) {
  const q = useAudits({ hostname, kind: "audit", limit: 50 });
  return (q.data?.items ?? []).filter((a) => a.status === "completed" || a.status === "partial");
}

function BenchmarksView({ id }: { id: string }) {
  const b = useBenchmarks(id);
  const start = useBenchmarkStart(id);
  const [url, setUrl] = useState("");
  const [ok, setOk] = useState(false);
  const rows = b.data ? [...(b.data.own ? [{ ...b.data.own, own: true }] : []), ...b.data.competitors.map((c) => ({ ...c, own: false }))] : [];
  return (
    <div className="space-y-4">
      <Panel title="Competitor benchmark" description="A small passive sample (up to 15 public pages, robots.txt respected). Use it as a prompt for investigation, not a ranking.">
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); start.mutate({ url: /^https?:/i.test(url) ? url : `https://${url}` }, { onSuccess: () => setUrl("") }); }}>
          <div className="flex flex-wrap gap-2"><Input className="max-w-sm" placeholder="competitor.com" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Competitor URL" /><Button type="submit" size="sm" disabled={!url.trim() || !ok || start.isPending}>Benchmark</Button></div>
          <label className="flex items-start gap-2 text-xs text-muted-foreground"><input type="checkbox" className="mt-0.5" checked={ok} onChange={(e) => setOk(e.target.checked)} />I understand this requests only publicly reachable pages of the competitor at a low rate.</label>
          {start.error && <ErrorNote error={start.error} />}
        </form>
      </Panel>
      {b.isLoading ? <Loading /> : rows.length < 2 ? <p className="text-sm text-muted-foreground">No competitor benchmarks yet.</p> : (
        <div className="overflow-x-auto rounded-xl border"><table className="w-full text-sm"><thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="p-2">Site</th><th className="p-2">Status</th><th className="p-2">Overall</th><th className="p-2">Coverage</th><th className="p-2">Pages</th>{Object.keys(rows[0].categories).map((c) => <th key={c} className="p-2">{CATEGORY_SHORT_LABELS[c as keyof typeof CATEGORY_SHORT_LABELS] ?? c}</th>)}</tr></thead>
          <tbody className="divide-y">{rows.map((r) => <tr key={r.id} className={r.own ? "bg-primary/5" : ""}><td className="p-2 font-medium">{r.hostname}{r.own && " (you)"}</td><td className="p-2"><AuditStatusBadge s={r.status} /></td><td className="p-2 tabular-nums">{r.overall == null ? "n/a" : `${Math.round(r.overall)}${r.provisional ? "*" : ""}`}</td><td className="p-2 tabular-nums">{r.coverage == null ? "n/a" : pct(r.coverage)}</td><td className="p-2 tabular-nums">{r.pagesSampled}</td>{Object.keys(rows[0].categories).map((c) => <td key={c} className="p-2 tabular-nums">{r.categories[c] == null ? "n/a" : Math.round(r.categories[c] as number)}</td>)}</tr>)}</tbody></table></div>
      )}
      {b.data && <p className="text-xs text-muted-foreground">{b.data.note} * provisional.</p>}
    </div>
  );
}

function ExportAndGate({ id }: { id: string }) {
  const [minScore, setMinScore] = useState(70);
  const [maxCritical, setMaxCritical] = useState(0);
  const [maxHigh, setMaxHigh] = useState<number | null>(null);
  const [requireComplete, setRequireComplete] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const gate = useGate(id, { minScore, maxCritical, maxHigh, requireComplete }, true);
  const run = async (f: "csv" | "json" | "sarif") => { setBusy(f); setErr(null); try { await downloadExport(id, f); } catch (e) { setErr((e as Error).message); } finally { setBusy(null); } };
  const g = gate.data;
  return (
    <Panel title="Export and CI quality gate" className="wi-no-print">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => run("csv")}><FileSpreadsheet className="mr-1.5 h-4 w-4" />Findings CSV</Button>
        <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => run("json")}><FileJson className="mr-1.5 h-4 w-4" />Full JSON</Button>
        <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => run("sarif")}><ShieldCheck className="mr-1.5 h-4 w-4" />SARIF 2.1.0</Button>
        {busy && <Loader2 className="h-4 w-4 animate-spin" aria-label="Preparing export" />}
      </div>
      {err && <p role="alert" className="mt-2 text-xs text-red-400">{err}</p>}
      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <label className="text-xs">Minimum score<Input type="number" min={0} max={100} value={minScore} onChange={(e) => setMinScore(Math.min(100, Math.max(0, Number(e.target.value) || 0)))} /></label>
        <label className="text-xs">Max critical<Input type="number" min={0} value={maxCritical} onChange={(e) => setMaxCritical(Math.max(0, Number(e.target.value) || 0))} /></label>
        <label className="text-xs">Max high (blank = any)<Input type="number" min={0} value={maxHigh ?? ""} onChange={(e) => setMaxHigh(e.target.value === "" ? null : Math.max(0, Number(e.target.value) || 0))} /></label>
        <label className="flex items-end gap-2 pb-2 text-xs"><input type="checkbox" checked={requireComplete} onChange={(e) => setRequireComplete(e.target.checked)} />Reject provisional scores</label>
      </div>
      {g && (
        <div className={cn("mt-3 rounded-md border p-3 text-sm", g.passed ? "border-emerald-500/40" : "border-red-500/40")} role="status">
          <b className={g.passed ? "text-emerald-400" : "text-red-400"}>{g.passed ? "Gate passed" : "Gate failed"}</b>
          <span className="text-muted-foreground"> - score {g.score == null ? "n/a" : Math.round(g.score)}{g.provisional ? " (provisional)" : ""}, {g.counts.critical} critical and {g.counts.high} high outstanding, readiness: {g.readiness}</span>
          {g.reasons.length > 0 && <ul className="mt-1 list-disc pl-5 text-xs">{g.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
        </div>
      )}
      <p className="mt-2 text-xs text-muted-foreground">Pipelines can call <code>GET /api/v1/website-audits/{id}/gate?strict=1</code> with a signed-in user's ID token; strict mode answers HTTP 422 on failure.</p>
    </Panel>
  );
}
