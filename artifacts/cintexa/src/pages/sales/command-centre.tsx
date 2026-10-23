import { useMemo, useState } from "react";
import { Link } from "wouter";
import { Bot, Play, Power, Pause, Activity, ShieldAlert, Hourglass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSales } from "@/context/SalesContext";
import { sales } from "@/lib/sales/api";
import { useSalesMutation, useSalesQuery, useUrlFilter } from "@/lib/sales/hooks";
import { relative } from "@/lib/sales/format";
import { PageHeader, Panel, KpiCard, TabBar, QueryBoundary, StatusBadge, Tag, Select } from "@/components/sales/ui";
import { cn } from "@/lib/utils";
import { type CommandCentre, HEALTH_TONE, ago } from "@/lib/sales/agents";
import { AgentCard, AgentDrawer } from "@/components/sales/agents/AgentCard";
import { Findings } from "@/components/sales/agents/Findings";
import { ApprovalQueue } from "@/components/sales/agents/ApprovalQueue";
import { ActivityLog } from "@/components/sales/agents/ActivityLog";
import { Briefing } from "@/components/sales/agents/Briefing";

type Tab = "agents" | "findings" | "approvals" | "activity" | "briefing";
const GROUPS = ["all", "orchestration", "operations", "revenue", "customer", "intelligence", "governance"];

export default function CommandCentrePage() {
  const { can } = useSales();
  const full = can("agents:run");
  const canManage = can("agents:manage");
  const [tabRaw, setTab] = useUrlFilter("tab", full ? "agents" : "findings");
  const tab = (["agents", "findings", "approvals", "activity", "briefing"].includes(tabRaw) ? tabRaw : "agents") as Tab;
  const [group, setGroup] = useState("all");
  const [open, setOpen] = useState<string | null>(null);
  const q = useSalesQuery<CommandCentre>(full ? "/agents/command-centre" : null);
  const inv = ["/agents", "/approvals"];
  const orchestrate = useSalesMutation(() => sales.post<any>("/agents/orchestrate", {}), {
    invalidate: inv,
    success: (r) => `Cycle finished: ${r.agents.filter((a: any) => a.status === "completed").length} agents ran, ${r.totals.findings} findings, ${r.totals.approvalsPrepared} approvals requested${r.totals.failures ? `, ${r.totals.failures} failed` : ""}`,
  });
  const bulk = useSalesMutation((action: "enable_all" | "pause_all") => sales.post<any>("/agents/bulk", { action }), { invalidate: inv, success: (r) => `${r.changed.length} agents updated` });
  const names = useMemo(() => Object.fromEntries((q.data?.agents ?? []).map((a) => [a.key, a.name])), [q.data]);

  const tabs: { key: Tab; label: string; count?: number }[] = full
    ? [{ key: "agents", label: "Agents" }, { key: "findings", label: "Findings", count: q.data?.findings.open }, { key: "approvals", label: "Approvals", count: q.data?.pendingHumanDecisions }, { key: "activity", label: "Activity" }, { key: "briefing", label: "Executive briefing" }]
    : [{ key: "findings", label: "My findings" }];

  return (
    <>
      <PageHeader
        back={{ href: "/sales", label: "Sales overview" }}
        title="Sales AI Command Centre"
        description="24 specialised agents analyse your sales data. They recommend and prepare; people approve anything protected. Every number is computed from your records."
        actions={full && canManage ? (
          <>
            <Button variant="outline" size="sm" disabled={bulk.pending} onClick={() => bulk.run("enable_all")}><Power className="mr-1 h-4 w-4" />Activate all</Button>
            <Button variant="outline" size="sm" disabled={bulk.pending} onClick={() => bulk.run("pause_all")}><Pause className="mr-1 h-4 w-4" />Pause all</Button>
            <Button size="sm" disabled={orchestrate.pending} onClick={() => orchestrate.run()}><Play className={cn("mr-1 h-4 w-4", orchestrate.pending && "animate-pulse")} />{orchestrate.pending ? "Running network…" : "Run all agents"}</Button>
          </>
        ) : full ? <Button size="sm" disabled={orchestrate.pending} onClick={() => orchestrate.run()}><Play className="mr-1 h-4 w-4" />Run all agents</Button> : undefined}
      />
      {full && (
        <QueryBoundary q={q} skeletonRows={6}>
          {(d) => {
            const h = HEALTH_TONE[d.health];
            return (
              <div className="mb-5 space-y-4">
                <div className={cn("flex flex-wrap items-center gap-3 rounded-xl border p-4 transition-colors", d.health === "healthy" ? "border-emerald-500/30 bg-gradient-to-r from-emerald-500/10 to-transparent" : d.health === "degraded" ? "border-rose-500/40 bg-gradient-to-r from-rose-500/10 to-transparent" : d.health === "attention" ? "border-amber-500/40 bg-gradient-to-r from-amber-500/10 to-transparent" : "bg-card")}>
                  <span className="relative flex h-3 w-3"><span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-60", d.health === "healthy" ? "bg-emerald-400" : d.health === "idle" ? "bg-slate-400" : "bg-amber-400")} /><span className={cn("relative inline-flex h-3 w-3 rounded-full", d.health === "healthy" ? "bg-emerald-500" : d.health === "degraded" ? "bg-rose-500" : d.health === "attention" ? "bg-amber-500" : "bg-slate-400")} /></span>
                  <div className="min-w-0 flex-1"><p className="text-sm font-semibold">System health: <StatusBadge status={d.health} tone={h.tone} label={h.label} /></p><p className="text-xs text-muted-foreground">{h.text} {d.lastSuccessfulExecution ? `Last successful run ${relative(d.lastSuccessfulExecution)}.` : "No successful run yet."}</p></div>
                  <Tag>{d.ai.mode === "ai_narration_available" ? "AI narration available" : "Deterministic mode (no AI used)"}</Tag>
                </div>
                {d.ai.mode === "deterministic_only" && <p className="rounded-lg border border-sky-500/30 bg-sky-500/10 p-3 text-xs">Agents work fully without AI. To add plain-language explanations, an administrator must switch on <strong>Sales Settings → Integrations → AI</strong>, allow an external provider, and the server needs an OpenRouter key. Until then no record data leaves your system.</p>}
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
                  <KpiCard label="Configured" value={d.totals.configured} />
                  <KpiCard label="Active" value={d.totals.active} tone="success" hint={`${d.totals.idle} idle · ${d.totals.running} running`} />
                  <KpiCard label="Paused / disabled" value={`${d.totals.paused} / ${d.totals.disabled}`} tone={d.totals.paused ? "warning" : undefined} />
                  <KpiCard label="Awaiting approval" value={d.pendingHumanDecisions} tone={d.pendingHumanDecisions ? "warning" : undefined} href="/sales/command-centre?tab=approvals" />
                  <KpiCard label="Failed runs (24h)" value={d.executions.failed24h} tone={d.executions.failed24h ? "danger" : "success"} hint={`of ${d.executions.runs24h} runs`} />
                  <KpiCard label="Tasks" value={`${d.tasks.completed}`} hint={`${d.tasks.queued} queued · ${d.tasks.failed} failed · ${d.executions.eventRetries} retries`} />
                  <KpiCard label="Avg duration" value={d.executions.avgDurationMs ? ago(d.executions.avgDurationMs) : "—"} />
                  <KpiCard label="AI usage" value={d.usage.tokens ? `${d.usage.tokens} tok` : "none"} hint={d.usage.estimatedCostUsd === null ? "no cost reported" : `$${d.usage.estimatedCostUsd.toFixed(4)} provider-reported`} />
                </div>
                {(d.events.dead > 0 || d.approvals.failed > 0 || d.approvals.executing > 0) && (
                  <div className="flex flex-wrap gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs"><ShieldAlert className="h-4 w-4 text-amber-500" />{d.events.dead > 0 && <span>{d.events.dead} dead-lettered events — </span>}{d.approvals.failed > 0 && <span>{d.approvals.failed} failed executions — </span>}{d.approvals.executing > 0 && <span>{d.approvals.executing} executions in progress — </span>}<Link href="/sales/command-centre?tab=activity" className="underline">inspect</Link></div>
                )}
                {d.findings.top.length > 0 && tab === "agents" && (
                  <Panel title={<span className="flex items-center gap-2"><Activity className="h-4 w-4 text-rose-500" />High-priority findings</span>} description="Highest priority first. Open the Findings tab for evidence and actions.">
                    <ul className="divide-y text-sm">{d.findings.top.slice(0, 5).map((f) => <li key={f.id} className="flex flex-wrap items-center gap-2 py-2"><StatusBadge status={f.severity} tone={f.severity === "critical" ? "danger" : "warning"} /><span className="min-w-0 flex-1 truncate">{f.title}</span><span className="text-xs text-muted-foreground">{names[f.agent_key] ?? f.agent_key}</span></li>)}</ul>
                  </Panel>
                )}
              </div>
            );
          }}
        </QueryBoundary>
      )}
      <TabBar<Tab> tabs={tabs} value={tab} onChange={setTab} />
      <div className="mt-4">
        {tab === "agents" && full && (
          <QueryBoundary q={q}>
            {(d) => {
              const list = d.agents.filter((a) => group === "all" || a.group === group);
              return (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2"><Bot className="h-4 w-4 text-muted-foreground" /><Select aria-label="Group" className="w-48" value={group} onChange={(e) => setGroup(e.target.value)}>{GROUPS.map((g) => <option key={g} value={g}>{g === "all" ? "All groups" : g[0]!.toUpperCase() + g.slice(1)}</option>)}</Select>
                    <span className="text-xs text-muted-foreground"><Hourglass className="mr-1 inline h-3 w-3" />Autonomy: L1 observe · L2 prepare · L3 execute internal actions. Customer messages, price changes, commission releases and other protected actions always need approval.</span></div>
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{list.map((a) => <AgentCard key={a.key} agent={a} canManage={canManage} canRun={full} onOpen={() => setOpen(a.key)} />)}</div>
                </div>
              );
            }}
          </QueryBoundary>
        )}
        {tab === "findings" && <Findings agentNames={full ? names : {}} canDecide />}
        {tab === "approvals" && full && <ApprovalQueue canManage={canManage} />}
        {tab === "activity" && full && <ActivityLog agentNames={names} canManage={canManage} />}
        {tab === "briefing" && full && <Briefing />}
      </div>
      <AgentDrawer agentKey={open} onClose={() => setOpen(null)} canManage={canManage} canRun={full} />
    </>
  );
}
