import { useState } from "react";
import { RotateCcw, EyeOff, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sales } from "@/lib/sales/api";
import { useSalesMutation, useSalesQuery } from "@/lib/sales/hooks";
import { dateTime } from "@/lib/sales/format";
import { StatusBadge, EmptyState, FilterBar, Select, Pagination, QueryBoundary, TabBar, Tag, Modal } from "@/components/sales/ui";
import { ago } from "@/lib/sales/agents";

type Sub = "executions" | "tasks" | "events";
const TONE: Record<string, any> = { success: "success", completed: "success", processed: "success", failed: "danger", dead: "danger", running: "info", queued: "warning", pending: "warning", cancelled: "neutral", ignored: "neutral", awaiting_approval: "warning" };

export function ActivityLog({ agentNames, canManage }: { agentNames: Record<string, string>; canManage: boolean }) {
  const [sub, setSub] = useState<Sub>("executions");
  const [agent, setAgent] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<any | null>(null);
  const path = `/agents/${sub}`;
  const q = useSalesQuery<any>(path, { agent_key: sub === "events" ? undefined : agent, status, page, page_size: 20 }, { keepPrevious: true });
  const inv = ["/agents"];
  const retry = useSalesMutation((id: number) => sales.post(`/agents/events/${id}/retry`, {}), { invalidate: inv, success: "Event queued for retry" });
  const ignore = useSalesMutation((id: number) => sales.post(`/agents/events/${id}/ignore`, {}), { invalidate: inv, success: "Event ignored" });
  const process = useSalesMutation(() => sales.post<any>("/agents/events/process", {}), { invalidate: inv, success: (r) => `Processed ${r?.processed ?? 0} events (${r?.runs ?? 0} agent runs, ${r?.failed ?? 0} failed, ${r?.dead ?? 0} dead)` });
  const open = async (id: number) => setDetail(await sales.get(`/agents/executions/${id}`).catch(() => null));
  return (
    <div className="space-y-3">
      <TabBar<Sub> tabs={[{ key: "executions", label: "Executions" }, { key: "tasks", label: "Tasks" }, { key: "events", label: "Event bus" }]} value={sub} onChange={(s) => { setSub(s); setPage(1); setStatus(""); }} />
      <FilterBar>
        {sub !== "events" && <Select aria-label="Agent" className="w-56" value={agent} onChange={(e) => { setAgent(e.target.value); setPage(1); }}><option value="">All agents</option>{Object.entries(agentNames).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</Select>}
        <Select aria-label="Status" className="w-40" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">Any status</option>{(sub === "executions" ? ["success", "failed", "running"] : sub === "tasks" ? ["queued", "running", "completed", "awaiting_approval", "failed", "cancelled"] : ["pending", "processed", "failed", "dead", "ignored"]).map((s) => <option key={s} value={s}>{s}</option>)}</Select>
        {sub === "events" && canManage && <Button size="sm" variant="outline" disabled={process.pending} onClick={() => process.run()}><Zap className="mr-1 h-3.5 w-3.5" />Process pending now</Button>}
      </FilterBar>
      <QueryBoundary q={q}>
        {(d) => d.items.length === 0 ? <EmptyState title={`No ${sub} yet`} description={sub === "events" ? "Domain events (lead created, stage changed…) are recorded here and handled by subscribed agents." : "Run an agent to see its history."} /> : (
          <>
            <div className="overflow-x-auto rounded-xl border"><table className="w-full text-left text-xs">
              <thead className="bg-secondary/50 text-muted-foreground"><tr>
                {sub === "executions" && <><th className="p-2">Started</th><th>Agent</th><th>Status</th><th>Level</th><th>AI</th><th>Findings</th><th>Prepared / executed</th><th>Duration</th><th></th></>}
                {sub === "tasks" && <><th className="p-2">Queued</th><th>Agent</th><th>Kind</th><th>Trigger</th><th>Status</th><th>Attempts</th><th>Error</th></>}
                {sub === "events" && <><th className="p-2">Occurred</th><th>Type</th><th>Record</th><th>Origin</th><th>Status</th><th>Attempts</th><th>Last error</th><th></th></>}
              </tr></thead>
              <tbody className="divide-y">
                {d.items.map((r: any) => sub === "executions" ? (
                  <tr key={r.id} className="hover:bg-secondary/30"><td className="p-2 whitespace-nowrap">{dateTime(r.started_at)}</td><td>{agentNames[r.agent_key] ?? r.agent_key}</td><td><StatusBadge status={r.status} tone={TONE[r.status]} /></td><td>L{r.level}</td><td><Tag>{r.ai_status}{r.model ? ` · ${r.model}` : ""}</Tag></td><td>{r.findings_count}</td><td>{r.actions_prepared} / {r.actions_executed}</td><td>{r.latency_ms ? ago(r.latency_ms) : "—"}</td><td><Button size="sm" variant="ghost" onClick={() => open(r.id)}>Log</Button></td></tr>
                ) : sub === "tasks" ? (
                  <tr key={r.id}><td className="p-2 whitespace-nowrap">{dateTime(r.queued_at)}</td><td>{agentNames[r.agent_key] ?? r.agent_key}</td><td>{r.kind}</td><td>{r.trigger}</td><td><StatusBadge status={r.status} tone={TONE[r.status]} /></td><td>{r.attempts}</td><td className="max-w-xs truncate text-rose-500" title={r.error ?? ""}>{r.error ?? ""}</td></tr>
                ) : (
                  <tr key={r.id}><td className="p-2 whitespace-nowrap">{dateTime(r.occurred_at)}</td><td>{r.type}</td><td>{r.entity_type} #{r.entity_id}</td><td>{r.origin}</td><td><StatusBadge status={r.status} tone={TONE[r.status]} /></td><td>{r.attempts}</td><td className="max-w-xs truncate text-rose-500" title={r.last_error ?? ""}>{r.last_error ?? ""}</td>
                    <td className="whitespace-nowrap">{canManage && ["dead", "failed"].includes(r.status) && <><Button size="sm" variant="ghost" onClick={() => retry.run(r.id)}><RotateCcw className="mr-1 h-3.5 w-3.5" />Retry</Button><Button size="sm" variant="ghost" onClick={() => ignore.run(r.id)}><EyeOff className="mr-1 h-3.5 w-3.5" />Ignore</Button></>}</td></tr>
                ))}
              </tbody></table></div>
            <Pagination page={d.page} pageSize={d.pageSize} total={d.total} onPage={setPage} />
          </>
        )}
      </QueryBoundary>
      <Modal open={Boolean(detail)} onClose={() => setDetail(null)} title={detail ? `Execution #${detail.id} log` : ""} size="lg">
        {detail && <div className="space-y-2 text-xs"><p>{detail.agent_key} · {detail.status} · prompt {detail.prompt_version} · {detail.model ?? "no model used"}</p>{detail.error && <p className="text-rose-500">{detail.error}</p>}<ol className="space-y-1">{(detail.log ?? []).map((l: any, i: number) => <li key={i} className="rounded bg-secondary p-2"><span className="text-muted-foreground">{l.at?.slice(11, 19)} </span><strong>{l.step}</strong>{l.detail !== undefined && <pre className="mt-1 whitespace-pre-wrap">{typeof l.detail === "string" ? l.detail : JSON.stringify(l.detail, null, 1)}</pre>}</li>)}</ol></div>}
      </Modal>
    </div>
  );
}
