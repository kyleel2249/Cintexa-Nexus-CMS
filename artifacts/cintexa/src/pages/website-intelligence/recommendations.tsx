import { useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, ListPlus, ShieldCheck, Trash2 } from "lucide-react";
import { HORIZON_LABELS, type Horizon, type RecStatus, type TaskStatus } from "@workspace/wi-core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useAudit, useRecHistory, useRecWorkflow, useRecommendations, useTaskMutations, useTasks, type WiAllowedTransition, type WiRecommendation } from "@/lib/website-intelligence/api";
import { EmptyState, ErrorNote, Loading, Panel, SeverityBadge, WI, label } from "./components";

const HORIZONS: Horizon[] = ["immediate", "short", "strategic"];
const STATUS_CLASS: Record<RecStatus, string> = {
  NEW: "bg-secondary text-secondary-foreground", READY: "bg-sky-500/15 text-sky-700 dark:text-sky-300", AWAITING_APPROVAL: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  APPROVED: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", IN_PROGRESS: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300", IMPLEMENTED: "bg-teal-500/15 text-teal-700 dark:text-teal-300",
  VERIFYING: "bg-violet-500/15 text-violet-700 dark:text-violet-300", VERIFIED: "bg-emerald-600/20 text-emerald-800 dark:text-emerald-200", FAILED: "bg-red-500/15 text-red-700 dark:text-red-300",
  REJECTED: "bg-muted text-muted-foreground", DEFERRED: "bg-muted text-muted-foreground",
};
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "");

/** Status, contextual actions (only what the server says this person may do), assignee and history for one recommendation. */
function WorkflowPanel({ auditId, r, labels }: { auditId: string; r: WiRecommendation; labels: Record<string, string> }) {
  const wf = useRecWorkflow(auditId);
  const hist = useRecHistory(auditId, r.fingerprint);
  const [pending, setPending] = useState<WiAllowedTransition | null>(null);
  const [note, setNote] = useState("");
  const [assignee, setAssignee] = useState(r.workflow.assignee ?? "");
  const error = wf.transition.error ?? wf.assign.error ?? wf.verify.error;
  const send = (a: WiAllowedTransition, text: string) => {
    wf.transition.mutate(
      { fingerprint: r.fingerprint, to: a.to, note: text.trim() || undefined, expectedVersion: r.workflow.version, ...(a.to === "VERIFIED" ? { evidence: { method: "manual" as const } } : {}) },
      { onSuccess: () => { setPending(null); setNote(""); } },
    );
  };
  const click = (a: WiAllowedTransition) => {
    if (a.to === "VERIFYING" && r.workflow.status === "IMPLEMENTED") { wf.verify.mutate(r.fingerprint); return; }
    if (a.noteRequired || a.needsEvidence || a.confirm) { setPending(a); setNote(""); } else send(a, "");
  };
  const busy = wf.transition.isPending || wf.verify.isPending;
  return (
    <div className="wi-no-print space-y-3 rounded-md border bg-muted/20 p-3" aria-label="Approval workflow">
      <div className="flex flex-wrap items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-muted-foreground" aria-hidden />
        <span className={cn("rounded px-2 py-0.5 text-xs font-semibold", STATUS_CLASS[r.workflow.status])}>{labels[r.workflow.status] ?? r.workflow.status}</span>
        {r.execution.allowed
          ? <span className="text-xs text-emerald-700 dark:text-emerald-300">Approved by {r.execution.approvedBy}; an automation agent may act until {fmt(r.execution.expiresAt)}.</span>
          : <span className="text-xs text-muted-foreground">Automation agents may not act on this yet: {r.execution.reason}</span>}
      </div>
      {r.workflow.decisionNote && <p className="text-xs"><b>Decision note:</b> {r.workflow.decisionNote}</p>}
      {r.workflow.verification && <p className="text-xs"><b>Verified by:</b> {r.workflow.verification.method}{r.workflow.verification.auditId ? ` (audit ${r.workflow.verification.auditId.slice(0, 8)})` : ""}{r.workflow.verification.note ? ` - ${r.workflow.verification.note}` : ""}</p>}
      <div className="flex flex-wrap gap-2">
        {r.allowed.map((a) => (
          <Button key={a.to} size="sm" variant={a.to === "APPROVED" || a.to === "VERIFIED" ? "default" : "outline"} disabled={busy} onClick={() => click(a)}>{a.label}</Button>
        ))}
        {!r.allowed.length && <span className="text-xs text-muted-foreground">No actions available to you for this status.</span>}
      </div>
      {pending && (
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); send(pending, note); }}>
          <label className="block space-y-1 text-xs">{pending.to === "VERIFIED" ? "What did you check, and how? (recorded as manual verification evidence, at least 10 characters)" : pending.noteRequired ? "Reason (required)" : "Note (optional)"}
            <Input value={note} onChange={(e) => setNote(e.target.value)} className="h-8" autoFocus aria-label="Note" />
          </label>
          <div className="flex gap-2"><Button type="submit" size="sm" disabled={busy}>{`Confirm: ${pending.label}`}</Button><Button type="button" size="sm" variant="ghost" onClick={() => setPending(null)}>Cancel</Button></div>
        </form>
      )}
      <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); wf.assign.mutate({ fingerprint: r.fingerprint, assignee: assignee.trim() || null }); }}>
        <label className="space-y-1 text-xs">Assignee<Input value={assignee} onChange={(e) => setAssignee(e.target.value)} className="h-8 w-52" placeholder="email or name" /></label>
        <Button type="submit" size="sm" variant="outline" disabled={wf.assign.isPending || assignee.trim() === (r.workflow.assignee ?? "")}>Save assignee</Button>
      </form>
      {error && <ErrorNote error={error} />}
      {wf.verify.data && <p className="text-xs text-muted-foreground" role="status">Verification retest started. The result, not a person, decides whether this is verified.</p>}
      <details className="text-xs"><summary className="cursor-pointer font-medium">History ({hist.data?.events.length ?? 0})</summary>
        {hist.isLoading ? <p className="mt-1 text-muted-foreground">Loading</p> : (
          <ol className="mt-2 space-y-1">{(hist.data?.events ?? []).slice().reverse().map((e) => (
            <li key={e.id} className="flex flex-wrap gap-x-2"><span className="text-muted-foreground">{fmt(e.at)}</span><span>{e.actorKind === "user" ? e.actorId : `${e.actorKind}: ${e.actorId}`}</span><span>{e.from && e.to ? `${labels[e.from] ?? e.from} to ${labels[e.to] ?? e.to}` : e.action.replace(/_/g, " ")}</span>{e.note && <span className="text-muted-foreground">- {e.note}</span>}</li>
          ))}</ol>
        )}
      </details>
    </div>
  );
}

export default function RecommendationsPage({ id }: { id: string }) {
  const audit = useAudit(id);
  const recs = useRecommendations(id);
  const tasks = useTasks(id);
  const mut = useTaskMutations(id);
  const [open, setOpen] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<RecStatus | "ALL">("ALL");
  const [owner, setOwner] = useState("");
  const [due, setDue] = useState("");
  if (recs.isLoading) return <Loading />;
  if (recs.error) return <ErrorNote error={recs.error} />;
  const data = recs.data!;
  const taskFor = (fp: string) => (tasks.data ?? []).find((t) => t.fingerprint === fp);
  const hours = data.roadmap.totalEffortHours;
  const labels = Object.fromEntries(data.statuses.map((x) => [x.id, x.label]));
  const shown = statusFilter === "ALL" ? data.recommendations : data.recommendations.filter((r) => r.workflow.status === statusFilter);
  return (
    <div className="space-y-5">
      <Link href={`${WI}/audits/${id}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />Back to {audit.data?.config.name || audit.data?.hostname}</Link>
      <Panel title="How priority is calculated" description="Transparent and reproducible. No revenue or traffic gain is estimated."><p className="text-xs text-muted-foreground">{data.formula}</p><p className="mt-2 text-xs">Estimated total effort: {hours[0]}-{hours[1]} hours (planning range, not a commitment).</p></Panel>
      {data.recommendations.length > 0 && (
        <Panel title="Approval workflow" description={`Nothing is applied to a site until a person approves it${data.requireSeparateApprover ? ", and a second person must approve each request" : ""}. Automation agents can propose and report, never approve or verify.`}>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by status">
            <Button size="sm" variant={statusFilter === "ALL" ? "default" : "outline"} onClick={() => setStatusFilter("ALL")}>All ({data.recommendations.length})</Button>
            {data.statuses.filter((x) => data.counts[x.id] > 0).map((x) => <Button key={x.id} size="sm" title={x.description} variant={statusFilter === x.id ? "default" : "outline"} onClick={() => setStatusFilter(x.id)}>{x.label} ({data.counts[x.id]})</Button>)}
          </div>
        </Panel>
      )}
      {!data.recommendations.length ? <EmptyState title="No recommendations" body="No defects were confirmed in this audit, so there is nothing to fix. Review testing limitations in the findings explorer." /> : HORIZONS.map((h) => {
        const list = shown.filter((r) => r.horizon === h);
        if (!list.length) return null;
        return (
          <Panel key={h} title={HORIZON_LABELS[h]} description={`${list.length} recommendation(s)`}>
            <ul className="space-y-2">
              {list.map((r) => {
                const t = taskFor(r.fingerprint);
                return (
                  <li key={r.fingerprint} className="rounded-lg border">
                    <button type="button" className="flex w-full items-start gap-3 p-3 text-left" onClick={() => setOpen(open === r.fingerprint ? null : r.fingerprint)} aria-expanded={open === r.fingerprint}>
                      <span className="mt-0.5 w-6 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{r.rank}</span>
                      <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><SeverityBadge s={r.severity} /><span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase", STATUS_CLASS[r.workflow.status])}>{labels[r.workflow.status] ?? r.workflow.status}</span><span className="font-medium">{r.title}</span></div><div className="mt-1 text-xs text-muted-foreground">priority {Math.round(r.priorityScore)} - effort {r.effort} ({r.effortHours[0]}-{r.effortHours[1]} h){t ? ` - task: ${label(t.status)}` : ""}</div></div>
                    </button>
                    {open === r.fingerprint && (
                      <div className="space-y-2 border-t p-3 text-xs">
                        <p><b>Problem:</b> {r.problem}</p><p><b>Evidence:</b> {r.evidenceSummary}</p>
                        <p><b>Correction:</b> {r.correction}</p><p><b>Implementation:</b> {r.implementation}</p>
                        <p><b>Expected outcome:</b> {r.expectedOutcome}</p><p><b>Risk of inaction:</b> {r.riskOfInaction}</p><p><b>Verification:</b> {r.verification}</p>
                        <WorkflowPanel auditId={id} r={r} labels={labels} />
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
