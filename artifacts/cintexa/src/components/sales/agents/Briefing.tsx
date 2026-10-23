import { useState } from "react";
import { Link } from "wouter";
import { Sparkles, TrendingUp, TrendingDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSalesQuery } from "@/lib/sales/hooks";
import { money, relative } from "@/lib/sales/format";
import { Panel, QueryBoundary, StatusBadge, EmptyState, Tag } from "@/components/sales/ui";
import { SEVERITY_TONE, STAGE_LABEL, entityHref, type Severity, type Stage } from "@/lib/sales/agents";

const Delta = ({ cur, prev, fmt = (n: number) => String(n) }: { cur: number; prev: number; fmt?: (n: number) => string }) => {
  const up = cur >= prev;
  return <span className="flex items-baseline gap-2"><span className="text-2xl font-semibold tabular-nums">{fmt(cur)}</span><span className={up ? "text-emerald-500" : "text-rose-500"}>{up ? <TrendingUp className="inline h-4 w-4" /> : <TrendingDown className="inline h-4 w-4" />} <span className="text-xs">vs {fmt(prev)}</span></span></span>;
};

function Items({ items, empty }: { items: any[]; empty: string }) {
  if (!items.length) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return <ul className="space-y-3">{items.map((r) => {
    const href = entityHref(r.entity?.type, r.entity?.id);
    return (
      <li key={r.id} className="rounded-lg border p-3 animate-in fade-in">
        <div className="flex flex-wrap items-center gap-2"><StatusBadge status={r.severity} tone={SEVERITY_TONE[r.severity as Severity]} /><StatusBadge status={r.kind} tone={STAGE_LABEL[r.kind as Stage]?.tone} label={STAGE_LABEL[r.kind as Stage]?.label} />{r.owner && <Tag>Owner: {r.owner}</Tag>}{r.dueOn && <Tag>Due {r.dueOn}</Tag>}{r.impact != null && <Tag>{money(r.impact)}</Tag>}</div>
        <p className="mt-1 text-sm font-medium">{href ? <Link href={href} className="hover:underline">{r.title}</Link> : r.title}</p>
        <p className="text-xs text-muted-foreground">{r.detected}</p>
        {r.why && <p className="mt-1 text-xs"><span className="font-medium">Why: </span>{r.why}</p>}
        {r.action && <p className="text-xs"><span className="font-medium">Action: </span>{r.action}{r.expected ? ` → ${r.expected}` : ""}</p>}
        {r.evidence?.length > 0 && <p className="mt-1 text-[11px] text-muted-foreground">Evidence: {r.evidence.map((e: any) => `${e.label}${e.value !== null && e.value !== "" ? ` (${e.value})` : ""}`).join(" · ")}</p>}
      </li>
    );
  })}</ul>;
}

export function Briefing() {
  const [ai, setAi] = useState(false);
  const q = useSalesQuery<any>("/agents/briefing", { ai: ai ? 1 : undefined });
  return (
    <QueryBoundary q={q} skeletonRows={8}>
      {(b) => (
        <div className="space-y-4">
          <div className="rounded-xl border bg-gradient-to-r from-violet-500/15 via-sky-500/10 to-emerald-500/15 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><h3 className="text-base font-semibold">{b.ai.headline ?? "Executive briefing"}</h3><p className="text-xs text-muted-foreground">Generated {relative(b.generatedAt)} from your records and the agents’ stored findings.</p></div>
              <Button size="sm" variant="outline" onClick={() => setAi(true)} disabled={ai && q.loading}><Sparkles className="mr-1 h-4 w-4" />Add AI headline</Button>
            </div>
            {b.ai.summary && <p className="mt-2 text-sm">{b.ai.summary} <span className="text-xs text-muted-foreground">(AI-phrased; model {b.ai.model})</span></p>}
            {ai && !b.ai.summary && <p className="mt-2 text-xs text-muted-foreground">AI headline not available ({b.ai.status.replace("_", " ")}). The figures below are unaffected.</p>}
          </div>
          <Panel title="1 · What changed" description={b.whatChanged.bookedRevenue7d.definition}>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div><p className="text-xs text-muted-foreground">Booked revenue, 7 days</p><Delta cur={b.whatChanged.bookedRevenue7d.current} prev={b.whatChanged.bookedRevenue7d.previous} fmt={(n) => money(n)} /></div>
              <div><p className="text-xs text-muted-foreground">Opportunities won</p><Delta cur={b.whatChanged.opportunitiesWon7d.current} prev={b.whatChanged.opportunitiesWon7d.previous} /></div>
              <div><p className="text-xs text-muted-foreground">Opportunities lost</p><Delta cur={b.whatChanged.opportunitiesLost7d.current} prev={b.whatChanged.opportunitiesLost7d.previous} /></div>
              <div><p className="text-xs text-muted-foreground">New leads</p><Delta cur={b.whatChanged.newLeads7d.current} prev={b.whatChanged.newLeads7d.previous} /></div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">Findings: {b.whatChanged.findings.new24h} new and {b.whatChanged.findings.cleared24h} cleared in 24 h · {b.whatChanged.findings.open} open ({b.whatChanged.findings.openHighOrCritical} high or critical) · {b.pendingDecisions} decisions waiting for a person.</p>
          </Panel>
          <Panel title="2 · Why (largest drivers)"><Items items={b.why} empty="No findings yet. Activate agents and run them." /></Panel>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="3 · Most important risks"><Items items={b.risks} empty="No medium-or-higher risks are open." /></Panel>
            <Panel title="4 · Largest opportunities"><Items items={b.opportunities} empty="No opportunity findings are open." /></Panel>
          </div>
          <Panel title="5 · Recommended actions, owners and expected impact"><Items items={b.actions} empty="No recommended actions are open." />
            <p className="mt-3 rounded-md bg-secondary p-3 text-xs"><span className="font-medium">Expected business impact: </span>{money(b.expectedImpact.amountAtRisk)} flagged at risk · {money(b.expectedImpact.upsideIdentified)} upside identified. {b.expectedImpact.basis}.</p>
          </Panel>
          <p className="text-[11px] text-muted-foreground">{b.evidenceNote}</p>
        </div>
      )}
    </QueryBoundary>
  );
}
void EmptyState;
