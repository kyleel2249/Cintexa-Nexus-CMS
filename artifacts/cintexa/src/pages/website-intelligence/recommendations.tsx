import { useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, ListPlus, Trash2 } from "lucide-react";
import { HORIZON_LABELS, type Horizon, type Recommendation, type TaskStatus } from "@workspace/wi-core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAudit, useRecommendations, useTaskMutations, useTasks } from "@/lib/website-intelligence/api";
import { EmptyState, ErrorNote, Loading, Panel, SeverityBadge, WI, label } from "./components";

const HORIZONS: Horizon[] = ["immediate", "short", "strategic"];

export default function RecommendationsPage({ id }: { id: string }) {
  const audit = useAudit(id);
  const recs = useRecommendations(id);
  const tasks = useTasks(id);
  const mut = useTaskMutations(id);
  const [open, setOpen] = useState<string | null>(null);
  const [owner, setOwner] = useState("");
  const [due, setDue] = useState("");
  if (recs.isLoading) return <Loading />;
  if (recs.error) return <ErrorNote error={recs.error} />;
  const data = recs.data!;
  const taskFor = (fp: string) => (tasks.data ?? []).find((t) => t.fingerprint === fp);
  const hours = data.roadmap.totalEffortHours;
  return (
    <div className="space-y-5">
      <Link href={`${WI}/audits/${id}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />Back to {audit.data?.config.name || audit.data?.hostname}</Link>
      <Panel title="How priority is calculated" description="Transparent and reproducible. No revenue or traffic gain is estimated."><p className="text-xs text-muted-foreground">{data.formula}</p><p className="mt-2 text-xs">Estimated total effort: {hours[0]}-{hours[1]} hours (planning range, not a commitment).</p></Panel>
      {!data.recommendations.length ? <EmptyState title="No recommendations" body="No defects were confirmed in this audit, so there is nothing to fix. Review testing limitations in the findings explorer." /> : HORIZONS.map((h) => {
        const list = data.recommendations.filter((r) => r.horizon === h);
        if (!list.length) return null;
        return (
          <Panel key={h} title={HORIZON_LABELS[h]} description={`${list.length} recommendation(s)`}>
            <ul className="space-y-2">
              {list.map((r: Recommendation) => {
                const t = taskFor(r.fingerprint);
                return (
                  <li key={r.fingerprint} className="rounded-lg border">
                    <button type="button" className="flex w-full items-start gap-3 p-3 text-left" onClick={() => setOpen(open === r.fingerprint ? null : r.fingerprint)} aria-expanded={open === r.fingerprint}>
                      <span className="mt-0.5 w-6 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{r.rank}</span>
                      <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><SeverityBadge s={r.severity} /><span className="font-medium">{r.title}</span></div><div className="mt-1 text-xs text-muted-foreground">priority {Math.round(r.priorityScore)} - effort {r.effort} ({r.effortHours[0]}-{r.effortHours[1]} h){t ? ` - task: ${label(t.status)}` : ""}</div></div>
                    </button>
                    {open === r.fingerprint && (
                      <div className="space-y-2 border-t p-3 text-xs">
                        <p><b>Problem:</b> {r.problem}</p><p><b>Evidence:</b> {r.evidenceSummary}</p>
                        <p><b>Correction:</b> {r.correction}</p><p><b>Implementation:</b> {r.implementation}</p>
                        <p><b>Expected outcome:</b> {r.expectedOutcome}</p><p><b>Risk of inaction:</b> {r.riskOfInaction}</p><p><b>Verification:</b> {r.verification}</p>
                        {r.dependencies.length > 0 && <p><b>Depends on:</b> {r.dependencies.join(", ")}</p>}
                        {!t && <div className="wi-no-print flex flex-wrap items-end gap-2 pt-1"><label className="space-y-1">Owner<Input value={owner} onChange={(e) => setOwner(e.target.value)} className="h-8 w-44" /></label><label className="space-y-1">Deadline<Input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="h-8 w-40" /></label><Button size="sm" onClick={() => mut.create.mutate({ fingerprint: r.fingerprint, owner: owner || null, dueDate: due || null })} disabled={mut.create.isPending}><ListPlus className="mr-1.5 h-4 w-4" />Create task</Button></div>}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </Panel>
        );
      })}
      {mut.create.error && <ErrorNote error={mut.create.error} />}

      <Panel title="Remediation tasks" description="Owners, deadlines and status for the work above.">
        {!tasks.data?.length ? <p className="text-sm text-muted-foreground">No tasks yet. Open a recommendation and create a task.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-xs uppercase text-muted-foreground"><tr><th className="py-1">Task</th><th>Owner</th><th>Deadline</th><th>Status</th><th /></tr></thead>
            <tbody className="divide-y">{tasks.data.map((t) => (
              <tr key={t.id}><td className="py-2 pr-2">{t.title}<div className="text-xs text-muted-foreground">{label(t.horizon)}</div></td>
                <td><Input className="h-8 w-36" defaultValue={t.owner ?? ""} aria-label="Owner" onBlur={(e) => e.target.value !== (t.owner ?? "") && mut.patch.mutate({ taskId: t.id, patch: { owner: e.target.value || null } })} /></td>
                <td><Input type="date" className="h-8 w-36" defaultValue={t.dueDate ?? ""} aria-label="Deadline" onBlur={(e) => e.target.value !== (t.dueDate ?? "") && mut.patch.mutate({ taskId: t.id, patch: { dueDate: e.target.value || null } })} /></td>
                <td><select className="h-8 rounded-md border bg-background px-2 text-xs" value={t.status} aria-label="Task status" onChange={(e) => mut.patch.mutate({ taskId: t.id, patch: { status: e.target.value as TaskStatus } })}>{["todo", "in_progress", "blocked", "done"].map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></td>
                <td><Button size="sm" variant="ghost" aria-label="Delete task" onClick={() => mut.remove.mutate(t.id)}><Trash2 className="h-4 w-4" /></Button></td></tr>
            ))}</tbody></table></div>
        )}
        {(mut.patch.error || mut.remove.error) && <ErrorNote error={mut.patch.error ?? mut.remove.error} />}
      </Panel>
    </div>
  );
}
