import { useState } from "react";
import { Play, Pause, Power, Settings2, Stethoscope, FlaskConical, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sales } from "@/lib/sales/api";
import { useSalesMutation, useSalesQuery } from "@/lib/sales/hooks";
import { relative, dateTime } from "@/lib/sales/format";
import { StatusBadge, Drawer, Field, Select, Input, Checkbox, Tag, ProgressBar, QueryBoundary, DefinitionList, Modal } from "@/components/sales/ui";
import { cn } from "@/lib/utils";
import { type AgentView, LEVEL_LABEL, GROUP_COLOR, STAGE_LABEL, SEVERITY_TONE, ago } from "@/lib/sales/agents";

const STATUS_TONE = { active: "success", paused: "warning", disabled: "neutral" } as const;

export function AgentCard({ agent, canManage, canRun, onOpen }: { agent: AgentView; canManage: boolean; canRun: boolean; onOpen: () => void }) {
  const running = Boolean(agent.currentTask);
  const refresh = ["/agents"];
  const act = useSalesMutation((verb: string) => sales.post(`/agents/${agent.key}/${verb}`), { invalidate: refresh, success: (r: any) => `${agent.name}: ${r?.status ?? "updated"}` });
  const lvl = LEVEL_LABEL[agent.level]!;
  return (
    <article className={cn("group relative overflow-hidden rounded-xl border bg-gradient-to-br p-4 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg animate-in fade-in slide-in-from-bottom-2", GROUP_COLOR[agent.group] ?? "", agent.status !== "active" && "opacity-80")}>
      <div className="flex items-start justify-between gap-2">
        <button type="button" onClick={onOpen} className="min-w-0 text-left">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              {running && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75" />}
              <span className={cn("relative inline-flex h-2.5 w-2.5 rounded-full", running ? "bg-sky-500" : agent.status === "active" ? "bg-emerald-500" : agent.status === "paused" ? "bg-amber-500" : "bg-slate-400")} />
            </span>
            <h3 className="truncate text-sm font-semibold">{agent.name}</h3>
          </div>
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{agent.purpose}</p>
        </button>
        <StatusBadge status={agent.status} tone={STATUS_TONE[agent.status]} label={running ? "Running" : undefined} />
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <span title={lvl.hint}><Tag>L{agent.level} · {lvl.name}</Tag></span>
        <Tag>{agent.model.useAi ? `AI: ${agent.model.tier}` : "Deterministic"}</Tag>
        {agent.stats.pendingApprovals > 0 && <StatusBadge status="PENDING" tone="warning" label={`${agent.stats.pendingApprovals} awaiting approval`} />}
        {agent.stats.openFindings > 0 && <Tag>{agent.stats.openFindings} open findings</Tag>}
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
        <div><dt className="text-muted-foreground">Runs</dt><dd className="font-semibold tabular-nums">{agent.stats.runs}</dd></div>
        <div><dt className="text-muted-foreground">Success</dt><dd className="font-semibold tabular-nums">{agent.stats.successRate === null ? "—" : `${agent.stats.successRate}%`}</dd></div>
        <div><dt className="text-muted-foreground">Last run</dt><dd className="font-semibold">{agent.lastSuccessAt ? relative(agent.lastSuccessAt) : "never"}</dd></div>
      </dl>
      {agent.limitations && <p className="mt-2 rounded-md bg-background/60 p-2 text-[11px] text-muted-foreground">{agent.limitations}</p>}
      {(canManage || canRun) && (
        <div className="mt-3 flex flex-wrap gap-1.5 border-t pt-3">
          {canManage && agent.status === "active" && <Button size="sm" variant="outline" disabled={act.pending} onClick={() => act.run("pause")}><Pause className="mr-1 h-3.5 w-3.5" />Pause</Button>}
          {canManage && agent.status === "paused" && <Button size="sm" disabled={act.pending} onClick={() => act.run("resume")}><Play className="mr-1 h-3.5 w-3.5" />Resume</Button>}
          {canManage && agent.status === "disabled" && <Button size="sm" disabled={act.pending} onClick={() => act.run("enable")}><Power className="mr-1 h-3.5 w-3.5" />Enable</Button>}
          {canManage && agent.status !== "disabled" && <Button size="sm" variant="ghost" disabled={act.pending} onClick={() => act.run("disable")} title="Disable completely">Disable</Button>}
          <Button size="sm" variant="ghost" onClick={onOpen}><Settings2 className="mr-1 h-3.5 w-3.5" />Details</Button>
        </div>
      )}
    </article>
  );
}

export function AgentDrawer({ agentKey, onClose, canManage, canRun }: { agentKey: string | null; onClose: () => void; canManage: boolean; canRun: boolean }) {
  const q = useSalesQuery<any>(agentKey ? `/agents/${agentKey}` : null);
  const [result, setResult] = useState<{ title: string; body: unknown } | null>(null);
  const run = useSalesMutation((mode: "analysis" | "test" | "diagnostic") => sales.post<any>(`/agents/${agentKey}/run`, { mode }), {
    invalidate: ["/agents"], silentError: false,
    onSuccess: (r) => setResult({ title: r?.checks ? "Diagnostic" : r?.preview ? "Test run (nothing was saved)" : "Run result", body: r }),
  });
  return (
    <Drawer open={Boolean(agentKey)} onClose={onClose} title={q.data?.name ?? "Agent"} subtitle={q.data ? `v${q.data.version} · ${q.data.group}` : undefined} width="max-w-3xl">
      <QueryBoundary q={q}>
        {(a: any) => (
          <div className="space-y-5">
            <p className="text-sm text-muted-foreground">{a.purpose}</p>
            {a.limitations && <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs">{a.limitations}</p>}
            <DefinitionList items={[
              { label: "Status", value: <StatusBadge status={a.status} tone={STATUS_TONE[a.status as keyof typeof STATUS_TONE]} /> },
              { label: "Autonomy level", value: `L${a.level} ${LEVEL_LABEL[a.level]!.name} (max L${a.maxLevel}) — ${LEVEL_LABEL[a.level]!.hint}` },
              { label: "Model", value: a.model.useAi ? `${a.model.resolved} (${a.model.tier})${a.model.fallback ? `, fallback ${a.model.fallback}` : ""}` : "AI narration off for this agent" },
              { label: "Schedule", value: a.schedule.everyMinutes ? `every ${a.schedule.everyMinutes} min; next ${a.schedule.nextRunAt ? dateTime(a.schedule.nextRunAt) : "on activation"}` : "manual / event-driven only" },
              { label: "Tools (fixed in code)", value: <div className="flex flex-wrap gap-1">{a.tools.map((t: string) => <Tag key={t}>{t}</Tag>)}</div> },
              { label: "Reads", value: <div className="flex flex-wrap gap-1">{a.reads.map((t: string) => <Tag key={t}>{t}</Tag>)}</div> },
              { label: "Event triggers", value: a.events.length ? a.events.join(", ") : "none" },
              { label: "Cost / tokens", value: `${a.stats.tokens} tokens · ${a.stats.costUsd ? `$${a.stats.costUsd.toFixed(4)} provider-reported` : "no provider-reported cost"}` },
              { label: "Latency", value: a.stats.avgLatencyMs ? `avg ${ago(a.stats.avgLatencyMs)}` : "—" },
              { label: "Evaluation", value: a.evaluation.acceptanceRate === null ? a.evaluation.note : `${a.evaluation.acceptanceRate}% accepted · ${a.evaluation.falsePositiveRate}% dismissed (${a.evaluation.decidedRecommendations} decisions)` },
            ]} />
            {a.stats.successRate !== null && <div><p className="mb-1 text-xs text-muted-foreground">Success rate</p><ProgressBar value={a.stats.successRate} tone={a.stats.successRate >= 90 ? "success" : a.stats.successRate >= 60 ? "warning" : "danger"} /></div>}
            {canRun && (
              <div className="flex flex-wrap gap-2 border-y py-3">
                <Button size="sm" variant="outline" disabled={run.pending} onClick={() => run.run("diagnostic")}><Stethoscope className="mr-1 h-4 w-4" />Run diagnostic</Button>
                <Button size="sm" variant="outline" disabled={run.pending} onClick={() => run.run("test")}><FlaskConical className="mr-1 h-4 w-4" />Test run (no changes)</Button>
                {a.key !== "chief_orchestrator" && a.status === "active" && <Button size="sm" disabled={run.pending} onClick={() => run.run("analysis")}><RotateCcw className="mr-1 h-4 w-4" />Run now</Button>}
              </div>
            )}
            {canManage && <AgentConfig agent={a} />}
            <section>
              <h4 className="mb-2 text-sm font-semibold">Recent executions</h4>
              {a.recentExecutions.length === 0 ? <p className="text-xs text-muted-foreground">No executions yet.</p> : (
                <ul className="divide-y rounded-lg border text-xs">
                  {a.recentExecutions.map((e: any) => (
                    <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                      <span className="flex items-center gap-2"><StatusBadge status={e.status} tone={e.status === "success" ? "success" : e.status === "failed" ? "danger" : "info"} /><span>{dateTime(e.started_at)}</span></span>
                      <span className="text-muted-foreground">{e.findings_count} findings · {e.actions_prepared} prepared · {e.actions_executed} executed · AI {e.ai_status}{e.latency_ms ? ` · ${ago(e.latency_ms)}` : ""}</span>
                      {e.error && <span className="w-full text-rose-500">{e.error}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section>
              <h4 className="mb-2 text-sm font-semibold">Recent findings</h4>
              <ul className="space-y-1 text-xs">{a.recentFindings.map((f: any) => <li key={f.id} className="flex items-center gap-2"><StatusBadge status={f.severity} tone={SEVERITY_TONE[f.severity as keyof typeof SEVERITY_TONE]} /><span className="truncate">{f.title}</span><span className="ml-auto text-muted-foreground">{f.status}</span></li>)}{a.recentFindings.length === 0 && <li className="text-muted-foreground">None yet.</li>}</ul>
            </section>
          </div>
        )}
      </QueryBoundary>
      <Modal open={Boolean(result)} onClose={() => setResult(null)} title={result?.title ?? ""} size="lg">
        {result && <ResultView body={result.body} />}
      </Modal>
    </Drawer>
  );
}

function ResultView({ body }: { body: any }) {
  if (body?.checks) return (
    <ul className="space-y-2 text-sm">{body.checks.map((c: any) => <li key={c.name} className="flex gap-2"><span className={c.ok ? "text-emerald-500" : "text-rose-500"}>{c.ok ? "✔" : "✖"}</span><span><strong>{c.name}</strong> — {c.detail}</span></li>)}<li className="pt-2 text-xs text-muted-foreground">{body.note}</li></ul>
  );
  const items: any[] = body?.preview ?? [];
  return (
    <div className="space-y-3 text-sm">
      <p>{body?.status === "failed" ? <span className="text-rose-500">{body.error}</span> : `${body?.findings ?? 0} findings. ${body?.preview ? "Nothing was saved or changed." : `${body?.created ?? 0} new, ${body?.updated ?? 0} updated, ${body?.resolved ?? 0} cleared.`}`}</p>
      {items.slice(0, 12).map((f, i) => (
        <div key={i} className="rounded-lg border p-3">
          <div className="flex items-center gap-2"><StatusBadge status={f.stage} tone={STAGE_LABEL[f.stage as keyof typeof STAGE_LABEL]?.tone} label={STAGE_LABEL[f.stage as keyof typeof STAGE_LABEL]?.label} /><StatusBadge status={f.severity} tone={SEVERITY_TONE[f.severity as keyof typeof SEVERITY_TONE]} /></div>
          <p className="mt-1 font-medium">{f.title}</p><p className="text-xs text-muted-foreground">{f.whatDetected}</p>
        </div>
      ))}
    </div>
  );
}

function AgentConfig({ agent }: { agent: any }) {
  const [level, setLevel] = useState(String(agent.level));
  const [tier, setTier] = useState(agent.model.tier);
  const [model, setModel] = useState(agent.model.override ?? "");
  const [fallback, setFallback] = useState(agent.model.fallback ?? "");
  const [useAi, setUseAi] = useState(Boolean(agent.model.useAi));
  const [every, setEvery] = useState(agent.schedule.everyMinutes ? String(agent.schedule.everyMinutes) : "");
  const [th, setTh] = useState<Record<string, string>>(Object.fromEntries(Object.entries(agent.thresholds).map(([k, v]) => [k, String(v)])));
  const save = useSalesMutation(() => sales.patch(`/agents/${agent.key}`, {
    level: Number(level), model_tier: tier, model: model.trim() || null, fallback_model: fallback.trim() || null, use_ai: useAi,
    schedule_minutes: every.trim() ? Number(every) : null, thresholds: Object.fromEntries(Object.entries(th).filter(([, v]) => v !== "").map(([k, v]) => [k, Number(v)])),
  }), { invalidate: ["/agents"], success: "Agent configuration saved" });
  return (
    <section className="space-y-3 rounded-lg border bg-secondary/30 p-3">
      <h4 className="text-sm font-semibold">Configuration</h4>
      <p className="text-xs text-muted-foreground">Tools, data access, approval rules and audit logging are fixed in code and cannot be changed here or by the agent.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Autonomy level"><Select value={level} onChange={(e) => setLevel(e.target.value)}>{[1, 2, 3].filter((n) => n <= agent.maxLevel).map((n) => <option key={n} value={n}>L{n} · {LEVEL_LABEL[n]!.name}</option>)}</Select></Field>
        <Field label="Model tier"><Select value={tier} onChange={(e) => setTier(e.target.value)}><option value="economy">Economy (classification)</option><option value="standard">Standard</option><option value="reasoning">Reasoning (complex analysis)</option></Select></Field>
        <Field label="Model override" hint="Optional OpenRouter model id"><Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="e.g. openai/gpt-4o-mini" /></Field>
        <Field label="Fallback model" hint="Used if the first model fails"><Input value={fallback} onChange={(e) => setFallback(e.target.value)} /></Field>
        <Field label="Run every (minutes)" hint="5–10080; blank = manual/event only"><Input inputMode="numeric" value={every} onChange={(e) => setEvery(e.target.value)} /></Field>
        <div className="flex items-end"><Checkbox label="Use AI to write plain-language narrative" checked={useAi} onChange={(e) => setUseAi(e.target.checked)} /></div>
      </div>
      {Object.keys(th).length > 0 && (
        <div><p className="mb-1 text-xs font-medium">Thresholds</p><div className="grid gap-3 sm:grid-cols-3">{Object.keys(th).map((k) => <Field key={k} label={k}><Input inputMode="decimal" value={th[k]} onChange={(e) => setTh({ ...th, [k]: e.target.value })} /></Field>)}</div></div>
      )}
      <Button size="sm" disabled={save.pending} onClick={() => save.run()}>Save configuration</Button>
    </section>
  );
}
