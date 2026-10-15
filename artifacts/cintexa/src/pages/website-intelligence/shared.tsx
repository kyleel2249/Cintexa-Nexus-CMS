import { CATEGORY_SHORT_LABELS } from "@workspace/wi-core";
import { usePublicBundle } from "@/lib/website-intelligence/api";
import { CategoryBars, CategoryRadar, ErrorNote, Loading, Panel, ScoreRing, SeverityBadge, SeverityChart, fmtDate, pct } from "./components";

/** Read-only client view reached through a revocable link. No notes, owners or credentials are included by the API. */
export default function SharedReport({ token }: { token: string }) {
  const q = usePublicBundle(token);
  if (q.isLoading) return <div className="p-8"><Loading text="Loading report" /></div>;
  if (q.error || !q.data) return <div className="mx-auto max-w-xl p-8"><ErrorNote error={q.error ?? new Error("This shared report is not available.")} /></div>;
  const { audit, findings } = q.data;
  const s = audit.scores;
  const data = (s?.categories ?? []).map((c) => ({ id: c.category, label: CATEGORY_SHORT_LABELS[c.category], score: c.score, coverage: c.coverage }));
  const defects = findings.filter((f) => f.kind === "defect");
  return (
    <main className="mx-auto max-w-5xl space-y-5 p-4 md:p-8">
      <header><p className="text-xs font-semibold uppercase tracking-wide text-primary">CINTEXA NEXUS - Website audit</p><h1 className="text-2xl font-semibold">{audit.config.name || audit.hostname}</h1><p className="text-sm text-muted-foreground break-all">{audit.url} - {fmtDate(audit.completedAt)}</p></header>
      {!s ? <p className="text-sm text-muted-foreground">This audit has no scores.</p> : (
        <>
          <Panel title="Overall"><div className="flex flex-wrap items-center gap-6"><ScoreRing score={s.overall} size={140} caption="Overall score" provisional={s.provisional} /><div className="space-y-1 text-sm"><div className="font-semibold">{s.band ?? "No band"}</div><div>{s.readiness.label}</div><div className="text-xs text-muted-foreground">Coverage {pct(s.coverage)}{s.provisional ? " - provisional" : ""}</div></div></div></Panel>
          <div className="grid gap-5 md:grid-cols-2"><Panel title="Categories"><CategoryRadar data={data} /></Panel><Panel title="Scores"><CategoryBars data={data} /></Panel></div>
          <Panel title="Severity"><SeverityChart counts={s.severityCounts} /></Panel>
        </>
      )}
      <Panel title="Priority findings" description="Critical and high-severity defects.">
        {!defects.filter((f) => f.severity === "critical" || f.severity === "high").length ? <p className="text-sm text-muted-foreground">No critical or high-severity defects were confirmed.</p> : (
          <ul className="divide-y">{defects.filter((f) => f.severity === "critical" || f.severity === "high").slice(0, 25).map((f) => <li key={f.id} className="py-2 text-sm"><div className="flex items-center gap-2"><SeverityBadge s={f.severity} /><b>{f.title}</b></div><p className="mt-1 text-xs text-muted-foreground">{f.description}</p><p className="mt-1 text-xs"><b>Fix:</b> {f.fix}</p></li>)}</ul>
        )}
      </Panel>
      <p className="text-xs text-muted-foreground">Automated, non-destructive assessment. Not a certification of accessibility conformance, compliance or security.</p>
    </main>
  );
}
