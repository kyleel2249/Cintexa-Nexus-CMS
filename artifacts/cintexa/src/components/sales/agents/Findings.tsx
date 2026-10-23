import { useState } from "react";
import { Link } from "wouter";
import { Check, X, ExternalLink, Sparkles, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sales } from "@/lib/sales/api";
import { useSalesMutation, useSalesQuery } from "@/lib/sales/hooks";
import { relative, money } from "@/lib/sales/format";
import { StatusBadge, EmptyState, FilterBar, Select, Pagination, QueryBoundary, Tag } from "@/components/sales/ui";
import { cn } from "@/lib/utils";
import { STAGE_LABEL, SEVERITY_TONE, entityHref, type Stage, type Severity } from "@/lib/sales/agents";

const SEV_BAR: Record<string, string> = { critical: "bg-rose-500", high: "bg-orange-500", medium: "bg-amber-400", low: "bg-sky-400", info: "bg-slate-400" };

export function Findings({ agentNames, canDecide }: { agentNames: Record<string, string>; canDecide: boolean }) {
  const [severity, setSeverity] = useState("");
  const [stage, setStage] = useState("");
  const [status, setStatus] = useState("open");
  const [agent, setAgent] = useState("");
  const [page, setPage] = useState(1);
  const q = useSalesQuery<any>("/agents/recommendations", { severity, stage, status, agent_key: agent, page, page_size: 15 }, { keepPrevious: true });
  return (
    <div className="space-y-3">
      <FilterBar>
        <Select aria-label="Status" className="w-36" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>{["open", "accepted", "dismissed", "actioned", "verified", "expired"].map((s) => <option key={s} value={s}>{s}</option>)}</Select>
        <Select aria-label="Severity" className="w-36" value={severity} onChange={(e) => { setSeverity(e.target.value); setPage(1); }}><option value="">Any severity</option>{["critical", "high", "medium", "low", "info"].map((s) => <option key={s} value={s}>{s}</option>)}</Select>
        <Select aria-label="Kind" className="w-44" value={stage} onChange={(e) => { setStage(e.target.value); setPage(1); }}><option value="">Any kind</option>{(Object.keys(STAGE_LABEL) as Stage[]).map((s) => <option key={s} value={s}>{STAGE_LABEL[s].label}</option>)}</Select>
        {Object.keys(agentNames).length > 0 && <Select aria-label="Agent" className="w-56" value={agent} onChange={(e) => { setAgent(e.target.value); setPage(1); }}><option value="">Any agent</option>{Object.entries(agentNames).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</Select>}
      </FilterBar>
      <QueryBoundary q={q}>
        {(d) => d.items.length === 0 ? (
          <EmptyState title="No findings" description={status === "open" ? "Nothing needs attention right now, or agents have not run yet. Activate agents and use “Run all agents”." : "No findings match these filters."} />
        ) : (
          <>
            <p className="text-[11px] text-muted-foreground">{Object.entries(d.legend as Record<string, string>).map(([k, v]) => `${STAGE_LABEL[k as Stage]?.label ?? k}: ${v}`).join("  ·  ")}</p>
            <ul className="space-y-3">{d.items.map((f: any) => <FindingCard key={f.id} f={f} agentName={agentNames[f.agent_key] ?? f.agent_key} canDecide={canDecide} />)}</ul>
            <Pagination page={d.page} pageSize={d.pageSize} total={d.total} onPage={setPage} />
          </>
        )}
      </QueryBoundary>
    </div>
  );
}

function FindingCard({ f, agentName, canDecide }: { f: any; agentName: string; canDecide: boolean }) {
  const [open, setOpen] = useState(false);
  const decide = useSalesMutation((verb: "accept" | "dismiss") => sales.post(`/agents/recommendations/${f.id}/${verb}`, {}), { invalidate: ["/agents"], success: (r: any) => `Marked ${r?.status}` });
  const href = entityHref(f.entity_type, f.entity_id);
  const st = STAGE_LABEL[f.stage as Stage];
  return (
    <li className="relative overflow-hidden rounded-xl border bg-card animate-in fade-in slide-in-from-bottom-1">
      <span className={cn("absolute inset-y-0 left-0 w-1", SEV_BAR[f.severity])} />
      <div className="space-y-2 p-4 pl-5">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={f.severity} tone={SEVERITY_TONE[f.severity as Severity]} />
          <span title={st?.hint}><StatusBadge status={f.stage} tone={st?.tone} label={st?.label} /></span>
          <Tag>{agentName}</Tag>
          {f.owner_name && <Tag>Owner: {f.owner_name}</Tag>}
          {f.due_on && <Tag>Due {String(f.due_on).slice(0, 10)}</Tag>}
          {f.impact != null && <Tag>{money(f.impact)} affected</Tag>}
          <span className="ml-auto text-[11px] text-muted-foreground">{relative(f.updated_at)}</span>
        </div>
        <h4 className="text-sm font-semibold">{f.title}</h4>
        <p className="text-sm"><span className="font-medium">Detected: </span>{f.what_detected}</p>
        {f.ai_narrative && <p className="rounded-md bg-violet-500/10 p-2 text-xs"><Sparkles className="mr-1 inline h-3 w-3 text-violet-500" /><span className="font-medium">AI-written explanation (generated from the facts above): </span>{f.ai_narrative}</p>}
        {open && (
          <div className="space-y-2 text-sm animate-in fade-in">
            {f.why_it_matters && <p><span className="font-medium">Why it matters: </span>{f.why_it_matters}</p>}
            {f.recommended_action && <p><span className="font-medium">Recommended action: </span>{f.recommended_action}</p>}
            {f.expected_outcome && <p><span className="font-medium">Expected outcome: </span>{f.expected_outcome}</p>}
            {f.assumptions && <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">Assumptions and limits</summary><pre className="mt-1 whitespace-pre-wrap rounded bg-secondary p-2">{JSON.stringify(f.assumptions, null, 2)}</pre></details>}
            <div><p className="mb-1 text-xs font-medium text-muted-foreground">Evidence</p><ul className="flex flex-wrap gap-1.5">{(f.evidence ?? []).map((e: any, i: number) => <li key={i} className="rounded-md border px-2 py-1 text-[11px]"><span className="text-muted-foreground">{e.type}: </span>{e.label}{e.value !== null && e.value !== undefined && e.value !== "" ? ` — ${e.value}` : ""}</li>)}</ul></div>
            {f.outcome && <p className="rounded bg-emerald-500/10 p-2 text-xs"><span className="font-medium">Outcome: </span>{f.outcome.note ?? JSON.stringify(f.outcome)}{f.outcome.observedStatus ? ` (record is now “${f.outcome.observedStatus}”)` : ""}</p>}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button size="sm" variant="ghost" onClick={() => setOpen(!open)}><ChevronDown className={cn("mr-1 h-4 w-4 transition-transform", open && "rotate-180")} />{open ? "Less" : "Why, evidence and next step"}</Button>
          {href && <Button size="sm" variant="outline" asChild><Link href={href}><ExternalLink className="mr-1 h-3.5 w-3.5" />Open record</Link></Button>}
          {canDecide && f.status === "open" && <>
            <Button size="sm" disabled={decide.pending} onClick={() => decide.run("accept")}><Check className="mr-1 h-3.5 w-3.5" />Accept</Button>
            <Button size="sm" variant="outline" disabled={decide.pending} onClick={() => decide.run("dismiss")}><X className="mr-1 h-3.5 w-3.5" />Dismiss</Button>
          </>}
        </div>
      </div>
    </li>
  );
}
