import { useState } from "react";
import { Check, X, Play, ClipboardCheck, Ban, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sales } from "@/lib/sales/api";
import { useSalesMutation, useSalesQuery } from "@/lib/sales/hooks";
import { dateTime, relative } from "@/lib/sales/format";
import { StatusBadge, EmptyState, FilterBar, Select, Pagination, QueryBoundary, ConfirmModal, Tag, Panel, Checkbox, Input } from "@/components/sales/ui";
import { APPROVAL_TONE, entityHref } from "@/lib/sales/agents";
import { Link } from "wouter";

export function ApprovalQueue({ canManage }: { canManage: boolean }) {
  const [status, setStatus] = useState("PENDING");
  const [page, setPage] = useState(1);
  const q = useSalesQuery<any>("/approvals", { status, page, page_size: 15 }, { keepPrevious: true });
  const [dialog, setDialog] = useState<{ kind: "reject" | "manual"; id: number } | null>(null);
  const inv = ["/approvals", "/agents"];
  const approve = useSalesMutation((id: number) => sales.post(`/approvals/${id}/approve`, {}, { idempotent: true }), { invalidate: inv, success: "Approved. Nothing has been done yet — execute it when ready." });
  const exec = useSalesMutation((id: number) => sales.post<any>(`/approvals/${id}/execute`, {}, { idempotent: true }), { invalidate: inv, success: (r) => (r?.status === "COMPLETED" ? "Executed" : `Execution ${String(r?.status ?? "").toLowerCase()}`) });
  const cancel = useSalesMutation((id: number) => sales.post(`/approvals/${id}/cancel`, {}), { invalidate: inv, success: "Cancelled" });
  const reject = useSalesMutation((a: { id: number; note: string }) => sales.post(`/approvals/${a.id}/reject`, { note: a.note }), { invalidate: inv, success: "Rejected", onSuccess: () => setDialog(null) });
  const manual = useSalesMutation((a: { id: number; note: string }) => sales.post(`/approvals/${a.id}/complete-manually`, { note: a.note }), { invalidate: inv, success: "Recorded as completed manually", onSuccess: () => setDialog(null) });
  return (
    <div className="space-y-4">
      <FilterBar>
        <Select aria-label="Status" className="w-40" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>{["PENDING", "APPROVED", "EXECUTING", "COMPLETED", "FAILED", "REJECTED", "CANCELLED", "EXPIRED"].map((s) => <option key={s} value={s}>{s}</option>)}<option value="">All</option></Select>
      </FilterBar>
      <QueryBoundary q={q}>
        {(d) => d.items.length === 0 ? <EmptyState title={`No ${status ? status.toLowerCase() : ""} approvals`} description="When an agent proposes a protected action it appears here. Nothing protected runs without a person's decision." /> : (
          <>
            <ul className="space-y-3">
              {d.items.map((a: any) => {
                const href = entityHref(a.entity_type, a.entity_id);
                return (
                  <li key={a.id} className="rounded-xl border bg-card p-4 animate-in fade-in slide-in-from-bottom-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={a.status} tone={APPROVAL_TONE[a.status]} />
                      <Tag>{a.action_label}</Tag>
                      <Tag>Needs {String(a.required_role).replace("_", " ")}</Tag>
                      {a.amount && <Tag>{a.amount} {a.currency ?? ""}</Tag>}
                      <span className="ml-auto text-[11px] text-muted-foreground">requested {relative(a.created_at)} by {a.requested_by.replace("agent:", "agent ")} · {a.status === "PENDING" ? `expires ${relative(a.expires_at)}` : ""}</span>
                    </div>
                    <p className="mt-2 text-sm font-medium">{a.summary}</p>
                    <details className="mt-1 text-xs"><summary className="cursor-pointer text-muted-foreground">Exact action that will run (hash {String(a.payload_hash).slice(0, 12)}…)</summary><pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-secondary p-2">{JSON.stringify(a.payload, null, 2)}</pre></details>
                    {a.decision_note && <p className="mt-1 text-xs text-muted-foreground">Decision note: {a.decision_note}{a.decided_by ? ` — ${a.decided_by}` : ""}</p>}
                    {a.error && <p className="mt-1 text-xs text-rose-500">{a.error}</p>}
                    {a.result && a.status === "COMPLETED" && <p className="mt-1 rounded bg-emerald-500/10 p-2 text-xs">{a.result.note ?? JSON.stringify(a.result)}{a.execution_mode === "manual" ? " (attested manually — the system did not verify it)" : ""}</p>}
                    {a.status === "APPROVED" && !a.has_executor && <p className="mt-1 text-xs text-muted-foreground">This action has no automatic executor. Do it in the relevant screen, then record it as completed.</p>}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {a.status === "PENDING" && a.canDecide && <>
                        <Button size="sm" disabled={approve.pending} onClick={() => approve.run(a.id)}><Check className="mr-1 h-3.5 w-3.5" />Approve</Button>
                        <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "reject", id: a.id })}><X className="mr-1 h-3.5 w-3.5" />Reject</Button>
                      </>}
                      {a.status === "PENDING" && !a.canDecide && <span className="self-center text-xs text-muted-foreground">You can’t decide this one (role, or you requested it).</span>}
                      {a.status === "APPROVED" && a.has_executor && a.canDecide && <Button size="sm" disabled={exec.pending} onClick={() => exec.run(a.id)}><Play className="mr-1 h-3.5 w-3.5" />Execute now</Button>}
                      {a.status === "APPROVED" && !a.has_executor && a.canDecide && <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "manual", id: a.id })}><ClipboardCheck className="mr-1 h-3.5 w-3.5" />Record as completed</Button>}
                      {["PENDING", "APPROVED"].includes(a.status) && <Button size="sm" variant="ghost" disabled={cancel.pending} onClick={() => cancel.run(a.id)}><Ban className="mr-1 h-3.5 w-3.5" />Cancel</Button>}
                      {href && <Button size="sm" variant="ghost" asChild><Link href={href}>Open record</Link></Button>}
                    </div>
                    <p className="mt-2 text-[11px] text-muted-foreground">Created {dateTime(a.created_at)}. Execution re-checks the record: if it changed after approval, the approval is voided.</p>
                  </li>
                );
              })}
            </ul>
            <Pagination page={d.page} pageSize={d.pageSize} total={d.total} onPage={setPage} />
          </>
        )}
      </QueryBoundary>
      <ConfirmModal open={dialog?.kind === "reject"} onClose={() => setDialog(null)} title="Reject this action" message="The agent will not repeat this proposal for the same unchanged record during the approval window." confirmLabel="Reject" danger reasonLabel="Reason" reasonRequired pending={reject.pending} onConfirm={(note) => dialog && reject.run({ id: dialog.id, note: note ?? "" })} />
      <ConfirmModal open={dialog?.kind === "manual"} onClose={() => setDialog(null)} title="Record as completed" message="Confirm that you performed this action in the system. This is your attestation; it is stored as a manual completion." confirmLabel="Record" reasonLabel="What was done" reasonRequired pending={manual.pending} onConfirm={(note) => dialog && manual.run({ id: dialog.id, note: note ?? "" })} />
      {canManage && <PolicyPanel />}
    </div>
  );
}

function PolicyPanel() {
  const q = useSalesQuery<any>("/approval-policies");
  const patch = useSalesMutation((a: { action: string; body: Record<string, unknown> }) => sales.patch(`/approval-policies/${a.action}`, a.body), { invalidate: ["/approval-policies"], success: "Policy saved" });
  return (
    <Panel title={<span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-emerald-500" />Approval policies</span>} description="Protected actions can never be made automatic. Others can be tuned. Every change is audited.">
      <QueryBoundary q={q}>
        {(d) => (
          <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="text-muted-foreground"><tr><th className="py-1 pr-3">Action</th><th className="pr-3">Approval</th><th className="pr-3">Approver</th><th className="pr-3">Threshold</th><th className="pr-3">Valid (h)</th><th>Executor</th></tr></thead>
            <tbody>{d.items.map((p: any) => (
              <tr key={p.action_type} className="border-t align-middle">
                <td className="py-2 pr-3"><div className="font-medium">{p.label}</div><div className="text-muted-foreground">{p.action_type}{p.always_protected ? " · protected" : ""}</div></td>
                <td className="pr-3"><Checkbox label={p.requires_approval ? "required" : "not required"} checked={p.requires_approval} disabled={p.always_protected} onChange={(e) => patch.run({ action: p.action_type, body: { requires_approval: e.target.checked, ...(e.target.checked ? { auto_executable: false } : {}) } })} /></td>
                <td className="pr-3"><Select aria-label="Approver role" className="w-32 py-1" value={p.approver_role} onChange={(e) => patch.run({ action: p.action_type, body: { approver_role: e.target.value } })}>{["sales_manager", "sales_director", "sales_admin", "finance"].map((r) => <option key={r} value={r}>{r.replace("sales_", "")}</option>)}</Select></td>
                <td className="pr-3"><Input className="w-24 py-1" defaultValue={p.threshold_amount ?? ""} placeholder="none" inputMode="decimal" onBlur={(e) => { const v = e.target.value.trim(); if (v !== (p.threshold_amount ?? "")) patch.run({ action: p.action_type, body: { threshold_amount: v === "" ? null : v } }); }} /></td>
                <td className="pr-3"><Input className="w-16 py-1" defaultValue={p.ttl_hours} inputMode="numeric" onBlur={(e) => { const n = Number(e.target.value); if (n && n !== p.ttl_hours) patch.run({ action: p.action_type, body: { ttl_hours: n } }); }} /></td>
                <td>{p.has_executor ? <Tag>{p.auto_executable ? "automatic" : "on approval"}</Tag> : <Tag>manual</Tag>}</td>
              </tr>))}</tbody></table></div>
        )}
      </QueryBoundary>
    </Panel>
  );
}
