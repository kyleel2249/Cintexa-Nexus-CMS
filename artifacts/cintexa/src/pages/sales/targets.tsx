import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSales } from "@/context/SalesContext";
import { sales } from "@/lib/sales/api";
import { useSalesMutation, useSalesQuery, useUrlFilter } from "@/lib/sales/hooks";
import { PERIOD_KINDS, TARGET_BASES, TARGET_METRICS, TARGET_SCOPES } from "@/lib/sales/enums";
import { dateOnly, money, num, percent } from "@/lib/sales/format";
import { PageHeader, Panel, Select, StatusBadge, ProgressBar, EmptyState, ErrorState, Skeleton, Modal, Field, Input, ConfirmModal, Tag } from "@/components/sales/ui";
import { FormModal } from "@/components/sales/forms";
import { RowsEditor } from "@/components/sales/RowsEditor";

interface Period { id: number; name: string; kind: string; starts_on: string; ends_on: string; status: string }
interface Target { id: number; scope: string; scope_id: number | null; scope_key: string; metric: string; basis: string; amount: string; parent_id: number | null; alert_threshold_percent: string; label: string; actual: string; sources: number; attainmentPercent: number | null; pacing: null | { status: string; elapsedPercent: number; expectedToDate: string; paceVariance: string; daysRemaining: number; requiredPerDay: string; projectedFinal: string; projectedAttainmentPercent: number | null }; isMoney: boolean; notes: string | null }

const NEXT: Record<string, { to: string; label: string }[]> = {
  draft: [{ to: "pending_approval", label: "Submit for approval" }],
  pending_approval: [{ to: "approved", label: "Approve period" }, { to: "draft", label: "Return to draft" }],
  approved: [{ to: "closed", label: "Close period" }],
  closed: [],
};

export default function TargetsPage() {
  const { can } = useSales();
  const periods = useSalesQuery<{ items: Period[] }>("/target-periods");
  const [pid, setPid] = useUrlFilter("period_id");
  const [dlg, setDlg] = useState<null | "period" | "target" | { edit: Target } | { allocate: Target } | { del: Target }>(null);
  const targets = useSalesQuery<{ period: Period | null; items: Target[]; basisNote?: string }>("/targets", { period_id: pid || undefined });
  const status = useSalesMutation((to: string) => sales.post(`/target-periods/${targets.data!.period!.id}/status`, { status: to }), { invalidate: ["/target-periods", "/targets", "/dashboard"], success: "Period updated" });
  const del = useSalesMutation((t: Target) => sales.del(`/targets/${t.id}`), { invalidate: ["/targets"], success: "Target removed", onSuccess: () => setDlg(null) });
  const period = targets.data?.period ?? null;
  const children = (id: number) => (targets.data?.items ?? []).filter((t) => t.parent_id === id);
  const tops = (targets.data?.items ?? []).filter((t) => !t.parent_id);
  return (
    <>
      <PageHeader title="Sales targets & quotas" description="Targets are set per period and scope. Attainment is calculated from confirmed orders on the basis you choose; periods must be approved before they count on dashboards."
        actions={<>
          {periods.data && periods.data.items.length > 0 && <Select aria-label="Period" className="w-52" value={pid || String(period?.id ?? "")} onChange={(e) => setPid(e.target.value)}>{periods.data.items.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.status})</option>)}</Select>}
          {can("targets:write") && <Button size="sm" variant="outline" onClick={() => setDlg("period")}><Plus className="mr-1.5 h-3.5 w-3.5" />New period</Button>}
          {can("targets:write") && period && period.status !== "closed" && <Button size="sm" onClick={() => setDlg("target")}><Plus className="mr-1.5 h-3.5 w-3.5" />New target</Button>}
        </>} />
      {targets.error && !targets.data ? <ErrorState error={targets.error} onRetry={() => void targets.refetch()} /> : !targets.data ? <Skeleton rows={6} /> : !period ? (
        <Panel><EmptyState title="No target period yet" description="Create a period (e.g. FY2027 Q1), then add targets for the company, teams or individuals." action={can("targets:write") ? <Button size="sm" onClick={() => setDlg("period")}>New period</Button> : undefined} /></Panel>
      ) : (
        <div className="space-y-6">
          <Panel title={period.name} description={`${dateOnly(period.starts_on)} – ${dateOnly(period.ends_on)}`} actions={<><StatusBadge status={period.status} />{can("targets:approve") && (NEXT[period.status] ?? []).map((n) => <Button key={n.to} size="sm" variant="outline" disabled={status.pending} onClick={() => void status.run(n.to)}>{n.label}</Button>)}</>}>
            <p className="text-sm text-muted-foreground">{targets.data.basisNote ?? "Attainment uses confirmed orders in the period, minus returns."}</p>
            {period.status !== "approved" && <p className="mt-1 text-xs text-amber-500">This period is {period.status.replace("_", " ")} — it does not appear on dashboards until it is approved.</p>}
            {status.error && <p role="alert" className="mt-2 text-sm text-rose-500">{status.error.message}</p>}
          </Panel>
          {tops.length === 0 ? <Panel><EmptyState title="No targets in this period" /></Panel> : (
            <div className="grid gap-4 md:grid-cols-2">
              {tops.map((t) => (
                <Panel key={t.id} title={t.label} description={`${t.metric.replace(/_/g, " ")} · ${t.basis}`} actions={can("targets:write") && period.status !== "closed" ? <><Button size="sm" variant="ghost" onClick={() => setDlg({ edit: t })}>Edit</Button>{t.scope !== "member" && period.status === "draft" && <Button size="sm" variant="ghost" onClick={() => setDlg({ allocate: t })}>Split</Button>}<Button size="sm" variant="ghost" className="text-rose-500" onClick={() => setDlg({ del: t })}>Remove</Button></> : undefined}>
                  <TargetBody t={t} />
                  {children(t.id).length > 0 && <ul className="mt-3 space-y-2 border-t pt-3">{children(t.id).map((c) => <li key={c.id}><div className="mb-0.5 flex justify-between text-xs"><span>{c.label}</span><span className="tabular-nums text-muted-foreground">{fmt(c, c.actual)} / {fmt(c, c.amount)}</span></div><ProgressBar value={c.attainmentPercent ?? 0} /></li>)}</ul>}
                </Panel>
              ))}
            </div>
          )}
        </div>
      )}
      <FormModal open={dlg === "period"} onClose={() => setDlg(null)} title="New target period" size="md" submitLabel="Create" success="Period created" invalidate={["/target-periods", "/targets"]}
        fields={[{ name: "name", label: "Name", required: true, wide: true }, { name: "kind", label: "Kind", type: "select", options: PERIOD_KINDS, required: true }, { name: "starts_on", label: "Starts", type: "date", required: true }, { name: "ends_on", label: "Ends", type: "date", required: true }]} initial={{ kind: "quarter" }}
        submit={(b) => sales.post("/target-periods", b)} onDone={(r) => setPid(String((r as { id: number }).id))} />
      {dlg === "target" && period && <TargetForm period={period} onClose={() => setDlg(null)} />}
      {typeof dlg === "object" && dlg && "edit" in dlg && <FormModal open onClose={() => setDlg(null)} title={`Edit ${dlg.edit.label}`} size="sm" initial={{ amount: dlg.edit.amount, alert_threshold_percent: dlg.edit.alert_threshold_percent, notes: dlg.edit.notes }} nullEmpty success="Target updated" invalidate={["/targets", "/dashboard"]}
        description={period?.status === "approved" ? "This period is approved — a reason is required and the change is audited." : undefined}
        fields={[{ name: "amount", label: "Amount", type: "money", required: true }, { name: "alert_threshold_percent", label: "Alert below % of pace", type: "number", min: 0, max: 100, required: true }, { name: "reason", label: "Reason for change", wide: true }, { name: "notes", label: "Notes", type: "textarea" }]} submit={(b) => sales.patch(`/targets/${dlg.edit.id}`, b)} />}
      {typeof dlg === "object" && dlg && "allocate" in dlg && <AllocateModal t={dlg.allocate} onClose={() => setDlg(null)} />}
      <ConfirmModal open={typeof dlg === "object" && !!dlg && "del" in dlg} onClose={() => setDlg(null)} title="Remove target?" message="Splits under it are removed too." confirmLabel="Remove" danger pending={del.pending} onConfirm={() => typeof dlg === "object" && dlg && "del" in dlg && void del.run(dlg.del)} />
    </>
  );
}

const fmt = (t: Target, v: string) => (t.isMoney ? money(v) : num(Number(v)));

function TargetBody({ t }: { t: Target }) {
  return (
    <>
      <div className="flex items-end justify-between"><p className="text-2xl font-semibold tabular-nums">{t.attainmentPercent == null ? "—" : percent(t.attainmentPercent)}</p><p className="text-sm tabular-nums text-muted-foreground">{fmt(t, t.actual)} of {fmt(t, t.amount)}</p></div>
      <div className="mt-2"><ProgressBar value={t.attainmentPercent ?? 0} tone={(t.attainmentPercent ?? 0) >= 100 ? "success" : undefined} /></div>
      {t.pacing && (
        <p className="mt-2 text-xs text-muted-foreground">
          <StatusBadge status={t.pacing.status === "behind" || t.pacing.status === "at_risk" ? "at_risk" : t.pacing.status === "achieved" || t.pacing.status === "ahead" || t.pacing.status === "on_track" ? "healthy" : "unknown"} label={t.pacing.status.replace("_", " ")} /> {t.pacing.elapsedPercent}% of the period elapsed · expected by now {fmt(t, t.pacing.expectedToDate)} · {t.pacing.daysRemaining} days left{t.pacing.status !== "achieved" && Number(t.pacing.requiredPerDay) > 0 ? ` · needs ${fmt(t, t.pacing.requiredPerDay)}/day` : ""} · run-rate projection {fmt(t, t.pacing.projectedFinal)} (an extrapolation, not a forecast)
        </p>
      )}
      <p className="mt-1 text-[11px] text-muted-foreground">{t.sources} order{t.sources === 1 ? "" : "s"} counted</p>
      {t.notes && <p className="mt-2 text-xs"><Tag>Note</Tag> {t.notes}</p>}
    </>
  );
}

function TargetForm({ period, onClose }: { period: Period; onClose: () => void }) {
  const { can } = useSales();
  const members = useSalesQuery<{ items: { id: number; display_name: string; active: boolean }[] }>(can("members:read") ? "/members" : null);
  const teams = useSalesQuery<{ items: { id: number; name: string }[] }>(can("teams:read") ? "/teams" : null);
  const terr = useSalesQuery<{ items: { id: number; name: string }[] }>(can("teams:read") ? "/territories" : null);
  const prods = useSalesQuery<{ items: { id: number; name: string }[] }>("/products", { pageSize: 200 });
  const [scope, setScope] = useState("company");
  const [scopeId, setScopeId] = useState("");
  const [scopeKey, setScopeKey] = useState("");
  const needsId = ["member", "team", "territory", "product"].includes(scope);
  const needsKey = ["category", "channel", "branch"].includes(scope);
  const opts = scope === "member" ? members.data?.items.filter((m) => m.active).map((m) => ({ id: m.id, name: m.display_name })) : scope === "team" ? teams.data?.items : scope === "territory" ? terr.data?.items : scope === "product" ? prods.data?.items : [];
  return (
    <FormModal open onClose={onClose} title="New target" submitLabel="Create" success="Target created" invalidate={["/targets", "/dashboard"]} initial={{ metric: "revenue", basis: "booked", alert_threshold_percent: 70 }}
      fields={[{ name: "metric", label: "Metric", type: "select", options: TARGET_METRICS, required: true }, { name: "basis", label: "Counted when", type: "select", options: TARGET_BASES, required: true }, { name: "amount", label: "Target (money for revenue/profit, a count otherwise)", type: "money", required: true, wide: true }, { name: "alert_threshold_percent", label: "Alert below % of pace", type: "number", min: 0, max: 100, required: true }, { name: "notes", label: "Notes", type: "textarea" }]}
      extra={<div className="grid gap-x-4 sm:grid-cols-2"><Field label="Applies to"><Select value={scope} onChange={(e) => { setScope(e.target.value); setScopeId(""); }}>{TARGET_SCOPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</Select></Field>
        {needsId && <Field label="Which one?" required><Select value={scopeId} onChange={(e) => setScopeId(e.target.value)}><option value="">Select…</option>{(opts ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select></Field>}
        {needsKey && <Field label="Name" required><Input value={scopeKey} onChange={(e) => setScopeKey(e.target.value)} /></Field>}</div>}
      submit={(b) => sales.post("/targets", { ...b, period_id: period.id, scope, ...(needsId ? { scope_id: Number(scopeId) } : {}), ...(needsKey ? { scope_key: scopeKey } : {}) })} />
  );
}

function AllocateModal({ t, onClose }: { t: Target; onClose: () => void }) {
  const members = useSalesQuery<{ items: { id: number; display_name: string; active: boolean }[] }>("/members");
  const [rows, setRows] = useState<{ member_id: string; weight: string }[]>([{ member_id: "", weight: "1" }]);
  const save = useSalesMutation(() => sales.post(`/targets/${t.id}/allocate`, { members: rows.map((r) => ({ member_id: Number(r.member_id), weight: Number(r.weight) })) }), { invalidate: ["/targets"], success: "Target split", onSuccess: onClose });
  return (
    <Modal open onClose={onClose} title={`Split ${t.label}`} description="The amount is divided by weight; rounding differences go to the largest share so the parts add up exactly." footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={save.pending || rows.some((r) => !r.member_id || !(Number(r.weight) > 0))} onClick={() => void save.run()}>Split</Button></>}>
      <RowsEditor rows={rows} onChange={setRows} blank={() => ({ member_id: "", weight: "1" })} addLabel="Add person" render={(r, up) => (<><Select aria-label="Member" value={r.member_id} onChange={(e) => up({ member_id: e.target.value })}><option value="">Select…</option>{members.data?.items.filter((m) => m.active).map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}</Select><Input aria-label="Weight" type="number" min="0.01" step="any" value={r.weight} onChange={(e) => up({ weight: e.target.value })} /></>)} />
      {save.error && <p role="alert" className="mt-2 text-sm text-rose-500">{save.error.message}</p>}
    </Modal>
  );
}
