import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSales } from "@/context/SalesContext";
import { sales } from "@/lib/sales/api";
import { useSalesMutation, useSalesQuery, useUrlFilter } from "@/lib/sales/hooks";
import { useList, useListState } from "@/lib/sales/list";
import { dateOnly, money, num } from "@/lib/sales/format";
import { PageHeader, Panel, TabBar, FilterBar, Select, Input, Field, DataTable, Pagination, StatusBadge, EmptyState, ErrorState, Skeleton, KpiCard, ConfirmModal, Modal, Tag, Checkbox, MoneyInput, type Column } from "@/components/sales/ui";
import { FormModal } from "@/components/sales/forms";
import { RowsEditor } from "@/components/sales/RowsEditor";
import { OwnerSelect } from "@/components/sales/pickers";

interface Entry { id: number; member_id: number; member_name: string; order_id: number; order_number: string; plan_name: string; kind: string; basis: string; basis_amount: string; split_percent: string; amount: string; status: string; period_label: string; adjustment_reason: string | null; paid_at: string | null; payout_reference: string | null }
interface Plan { id: number; name: string; version: number; kind: "percent" | "fixed" | "tiered"; basis: string; measure: string; rate: string | null; fixed_amount: string | null; tiers: { from: string; to: string | null; rate: string }[]; product_name: string | null; category: string | null; member_id: number | null; member_name: string | null; quota_bonus: { thresholdPercent: number; amount: string } | null; effective_from: string; effective_to: string | null; active: boolean }
type Tab = "entries" | "statement" | "plans";

const STATUSES = [{ value: "calculated", label: "Calculated" }, { value: "approved", label: "Approved" }, { value: "paid", label: "Paid" }, { value: "void", label: "Void" }];

export default function CommissionsPage() {
  const { can } = useSales();
  const [tabRaw, setTab] = useUrlFilter("tab", "entries");
  const tabs: { key: Tab; label: string }[] = [{ key: "entries", label: "Entries" }, { key: "statement", label: "Statement" }, ...(can("commissions:write") ? [{ key: "plans" as Tab, label: "Plans" }] : [])];
  const tab = (tabs.some((t) => t.key === tabRaw) ? tabRaw : "entries") as Tab;
  return (
    <>
      <PageHeader title="Commissions & incentives" description="Entries are calculated from confirmed orders using the plan version in force, and reversed automatically on returns or cancellations. Paying out here records the payout; it does not move money." />
      <TabBar<Tab> tabs={tabs} value={tab} onChange={setTab} />
      {tab === "statement" ? <StatementTab /> : tab === "plans" ? <PlansTab /> : <EntriesTab />}
    </>
  );
}

function EntriesTab() {
  const { can } = useSales();
  const [, nav] = useLocation();
  const st = useListState(["status", "member_id", "period"]);
  const q = useList<Entry>("/commissions", st) as ReturnType<typeof useList<Entry>> & { data?: { items: Entry[]; page: number; pageSize: number; total: number; totals: Record<string, string> } };
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [action, setAction] = useState<null | "approve" | "pay">(null);
  const [payRef, setPayRef] = useState("");
  const [voiding, setVoiding] = useState<Entry | null>(null);
  const [adjusting, setAdjusting] = useState<Entry | null>(null);
  const ids = [...sel];
  const done = () => { setSel(new Set()); setAction(null); setPayRef(""); };
  const approve = useSalesMutation(() => sales.post("/commissions/approve", { ids }, { idempotent: true }), { invalidate: ["/commissions"], success: "Entries approved", onSuccess: done });
  const pay = useSalesMutation(() => sales.post("/commissions/pay", { ids, payout_reference: payRef.trim() }, { idempotent: true }), { invalidate: ["/commissions"], success: "Payout recorded", onSuccess: done });
  const voidIt = useSalesMutation((r: { id: number; reason?: string }) => sales.post(`/commissions/${r.id}/void`, { reason: r.reason }), { invalidate: ["/commissions"], success: "Entry voided", onSuccess: () => setVoiding(null) });
  const toggle = (id: number) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const columns: Column<Entry>[] = [
    ...(can("commissions:approve") ? [{ key: "sel", header: "", render: (e: Entry) => (e.status === "calculated" || e.status === "approved") ? <input type="checkbox" aria-label={`Select entry ${e.id}`} checked={sel.has(e.id)} onChange={() => toggle(e.id)} onClick={(ev) => ev.stopPropagation()} /> : null }] : []),
    { key: "m", header: "Person", render: (e) => e.member_name },
    { key: "o", header: "Order", render: (e) => <button type="button" className="text-primary hover:underline" onClick={() => nav(`/sales/orders/${e.order_id}`)}>{e.order_number}</button> },
    { key: "k", header: "Type", hideOnMobile: true, render: (e) => <span>{e.kind === "adjustment" ? "Adjustment" : e.kind === "reversal" ? "Reversal" : "Commission"}{e.adjustment_reason ? <span className="block text-xs text-muted-foreground">{e.adjustment_reason}</span> : null}</span> },
    { key: "b", header: "Basis", hideOnMobile: true, align: "right", render: (e) => money(e.basis_amount) },
    { key: "a", header: "Amount", align: "right", render: (e) => money(e.amount) },
    { key: "s", header: "Status", render: (e) => <StatusBadge status={e.status} /> },
    { key: "p", header: "Period", hideOnMobile: true, render: (e) => e.period_label },
    { key: "x", header: "", render: (e) => can("commissions:approve") && e.status !== "void" ? (
      <span className="flex justify-end gap-1" onClick={(ev) => ev.stopPropagation()}>
        {e.status !== "paid" && <Button size="sm" variant="ghost" onClick={() => setAdjusting(e)}>Adjust</Button>}
        {e.status !== "paid" && <Button size="sm" variant="ghost" className="text-rose-500" onClick={() => setVoiding(e)}>Void</Button>}
      </span>) : null },
  ];
  const totals = q.data?.totals ?? {};
  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {STATUSES.slice(0, 3).map((s) => <KpiCard key={s.value} label={s.label} value={money(totals[s.value] ?? "0")} />)}
        <KpiCard label="Selected" value={String(ids.length)} hint={ids.length ? "entries" : "tick entries to approve or pay"} />
      </div>
      <FilterBar>
        <Select aria-label="Status" className="w-40" value={st.filters.status ?? ""} onChange={(e) => st.setFilter("status", e.target.value)}><option value="">Status: all</option>{STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</Select>
        <OwnerSelect value={st.filters.member_id ?? ""} onChange={(v) => st.setFilter("member_id", v)} />
        <Input aria-label="Period" className="w-32" placeholder="Period e.g. 2026-10" value={st.filters.period ?? ""} onChange={(e) => st.setFilter("period", e.target.value)} />
        {can("commissions:approve") && <Button size="sm" disabled={!ids.length} onClick={() => setAction("approve")}>Approve selected</Button>}
        {can("commissions:pay") && <Button size="sm" variant="outline" disabled={!ids.length} onClick={() => setAction("pay")}>Record payout</Button>}
      </FilterBar>
      <Panel flush>
        {q.error && !q.data ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data ? <Skeleton rows={8} /> : (
          <><DataTable caption="Commission entries" columns={columns} rows={q.data.items} rowKey={(e) => e.id} empty={<EmptyState title="No commission entries" description="Entries appear when an order is confirmed and a commission plan applies." />} />
            <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={st.setPage} /></>
        )}
      </Panel>
      <ConfirmModal open={action === "approve"} onClose={() => setAction(null)} title="Approve entries?" message={`${ids.length} selected entr${ids.length === 1 ? "y" : "ies"} will be approved. Only entries still in "calculated" are changed.`} confirmLabel="Approve" pending={approve.pending} onConfirm={() => void approve.run()} />
      <Modal open={action === "pay"} onClose={() => setAction(null)} title="Record payout" description="Approved entries only. Record the reference from your payroll or finance system; no money is moved from here."
        footer={<><Button variant="outline" onClick={() => setAction(null)}>Cancel</Button><Button disabled={pay.pending || payRef.trim().length < 2} onClick={() => void pay.run()}>Record payout</Button></>}>
        <Field label="Payout reference" required><Input value={payRef} onChange={(e) => setPayRef(e.target.value)} maxLength={120} /></Field>
        {pay.error && <p role="alert" className="mt-2 text-sm text-rose-500">{pay.error.message}</p>}
      </Modal>
      <ConfirmModal open={!!voiding} onClose={() => setVoiding(null)} title="Void entry?" message="Voided entries are excluded from statements. Paid entries can't be voided." confirmLabel="Void" danger reasonLabel="Reason" reasonRequired pending={voidIt.pending} onConfirm={(reason) => voiding && void voidIt.run({ id: voiding.id, reason })} />
      {adjusting && <FormModal open onClose={() => setAdjusting(null)} title={`Adjust entry for ${adjusting.order_number}`} description="Adds a separate adjustment entry (negative to reduce). The original entry is kept." success="Adjustment added" invalidate={["/commissions"]}
        fields={[{ name: "amount", label: "Adjustment amount", type: "money", required: true, hint: "Use a negative number to reduce." }, { name: "reason", label: "Reason", type: "textarea", required: true, wide: true }]}
        submit={(b) => sales.post(`/commissions/${adjusting.id}/adjust`, b, { idempotent: true })} />}
    </>
  );
}

function StatementTab() {
  const { can, me } = useSales();
  const [member, setMember] = useUrlFilter("member_id", "");
  const [period, setPeriod] = useUrlFilter("period", String(new Date().getFullYear()));
  const q = useSalesQuery<{ member_id: number; period: string; entries: Entry[]; totals: Record<string, string>; quotaBonus: null | { attainmentPercent: number | null; eligibleAmount: string; note: string } }>("/commissions/statement", { member_id: member || undefined, period: period || undefined });
  return (
    <>
      <FilterBar>
        {can("commissions:read") && me && me.scope !== "own" && <OwnerSelect value={member} onChange={setMember} />}
        <Input aria-label="Period (year or year-month)" className="w-40" value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="2026 or 2026-10" />
      </FilterBar>
      {q.error && !q.data ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data ? <Skeleton /> : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard label="Calculated" value={money(q.data.totals.calculated ?? "0")} /><KpiCard label="Approved" value={money(q.data.totals.approved ?? "0")} />
            <KpiCard label="Paid" value={money(q.data.totals.paid ?? "0")} /><KpiCard label="Outstanding" value={money(q.data.totals.outstanding ?? "0")} />
          </div>
          {q.data.quotaBonus && <p className="mb-4 rounded-md border bg-secondary/40 px-3 py-2 text-sm">Quota attainment {q.data.quotaBonus.attainmentPercent === null ? "n/a" : `${num(q.data.quotaBonus.attainmentPercent, 1)}%`} · eligible quota bonus {money(q.data.quotaBonus.eligibleAmount)}. <span className="text-muted-foreground">{q.data.quotaBonus.note}</span></p>}
          <Panel flush>
            <DataTable caption="Statement" rows={q.data.entries} rowKey={(e) => e.id} empty={<EmptyState title="No entries in this period" />} columns={[
              { key: "o", header: "Order", render: (e: Entry) => e.order_number }, { key: "k", header: "Type", hideOnMobile: true, render: (e: Entry) => e.kind }, { key: "p", header: "Plan", hideOnMobile: true, render: (e: Entry) => e.plan_name },
              { key: "a", header: "Amount", align: "right", render: (e: Entry) => money(e.amount) }, { key: "s", header: "Status", render: (e: Entry) => <StatusBadge status={e.status} /> }, { key: "d", header: "Paid", hideOnMobile: true, render: (e: Entry) => (e.paid_at ? dateOnly(e.paid_at) : "—") },
            ]} />
          </Panel>
        </>
      )}
    </>
  );
}

interface TierDraft { from: string; to: string; rate: string }

function PlansTab() {
  const q = useSalesQuery<{ items: Plan[] }>("/commission-plans");
  const [edit, setEdit] = useState<{ plan?: Plan; revise?: boolean } | null>(null);
  const [off, setOff] = useState<Plan | null>(null);
  const deactivate = useSalesMutation((p: Plan) => sales.post(`/commission-plans/${p.id}/deactivate`), { invalidate: ["/commission-plans"], success: "Plan deactivated", onSuccess: () => setOff(null) });
  return (
    <>
      <div className="mb-4 flex justify-end"><Button size="sm" onClick={() => setEdit({})}><Plus className="mr-1.5 h-3.5 w-3.5" />New plan</Button></div>
      <Panel flush>
        {q.error && !q.data ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data ? <Skeleton /> : (
          <DataTable caption="Commission plans" rows={q.data.items} rowKey={(p) => p.id} empty={<EmptyState title="No commission plans" description="Without an active plan, no commission is calculated." />} columns={[
            { key: "n", header: "Plan", render: (p: Plan) => <div><p className="font-medium">{p.name} <Tag>v{p.version}</Tag></p><p className="text-xs text-muted-foreground">{p.member_name ? `For ${p.member_name}` : "All sales people"}{p.product_name ? ` · ${p.product_name}` : ""}{p.category ? ` · ${p.category}` : ""}</p></div> },
            { key: "r", header: "Rule", render: (p: Plan) => p.kind === "percent" ? `${p.rate}% of ${p.measure === "gross_profit" ? "gross profit" : "revenue"}` : p.kind === "fixed" ? `${money(p.fixed_amount)} per order` : `${p.tiers.length} tiers` },
            { key: "b", header: "Basis", hideOnMobile: true, render: (p: Plan) => p.basis }, { key: "e", header: "Effective", hideOnMobile: true, render: (p: Plan) => `${dateOnly(p.effective_from)} → ${p.effective_to ? dateOnly(p.effective_to) : "open"}` },
            { key: "s", header: "Status", render: (p: Plan) => <StatusBadge status={p.active ? "active" : "inactive"} label={p.active ? "Active" : "Inactive"} /> },
            { key: "x", header: "", render: (p: Plan) => <span className="flex justify-end gap-1"><Button size="sm" variant="ghost" onClick={() => setEdit({ plan: p, revise: true })}>New version</Button>{p.active && <Button size="sm" variant="ghost" className="text-rose-500" onClick={() => setOff(p)}>Deactivate</Button>}</span> },
          ]} />
        )}
      </Panel>
      {edit && <PlanModal plan={edit.plan} revise={edit.revise} onClose={() => setEdit(null)} />}
      <ConfirmModal open={!!off} onClose={() => setOff(null)} title="Deactivate plan?" message="Existing entries are unaffected; no new entries use this plan." confirmLabel="Deactivate" danger pending={deactivate.pending} onConfirm={() => off && void deactivate.run(off)} />
    </>
  );
}

function PlanModal({ plan, revise, onClose }: { plan?: Plan; revise?: boolean; onClose: () => void }) {
  const [v, setV] = useState({ name: plan?.name ?? "", kind: plan?.kind ?? "percent", basis: plan?.basis ?? "collected", measure: plan?.measure ?? "revenue", rate: plan?.rate ?? "", fixed: plan?.fixed_amount ?? "", from: "", to: "", bonusOn: !!plan?.quota_bonus, bonusPct: String(plan?.quota_bonus?.thresholdPercent ?? 100), bonusAmt: plan?.quota_bonus?.amount ?? "" });
  const [tiers, setTiers] = useState<TierDraft[]>((plan?.tiers ?? []).map((t) => ({ from: t.from, to: t.to ?? "", rate: String(t.rate) })));
  const set = (p: Partial<typeof v>) => setV((x) => ({ ...x, ...p }));
  const body = useMemo(() => ({
    name: v.name.trim(), kind: v.kind, basis: v.basis, measure: v.measure,
    ...(v.kind === "percent" ? { rate: Number(v.rate) } : {}), ...(v.kind === "fixed" ? { fixed_amount: v.fixed } : {}),
    ...(v.kind === "tiered" ? { tiers: tiers.map((t) => ({ from: t.from, to: t.to || null, rate: Number(t.rate) })) } : {}),
    ...(plan?.member_id ? { member_id: plan.member_id } : {}),
    ...(v.bonusOn ? { quota_bonus: { threshold_percent: Number(v.bonusPct), amount: v.bonusAmt } } : {}),
    effective_from: v.from, ...(v.to ? { effective_to: v.to } : {}),
  }), [v, tiers, plan]);
  const save = useSalesMutation(() => (revise && plan ? sales.post(`/commission-plans/${plan.id}/revise`, body) : sales.post("/commission-plans", body)), { invalidate: ["/commission-plans", "/commissions"], success: revise ? "New version created" : "Plan created", onSuccess: onClose });
  const valid = v.name.trim().length >= 2 && !!v.from && (v.kind === "percent" ? v.rate !== "" : v.kind === "fixed" ? v.fixed !== "" : tiers.length > 0 && tiers.every((t) => t.from !== "" && t.rate !== ""));
  return (
    <Modal open onClose={onClose} size="lg" title={revise ? `New version of ${plan?.name}` : "New commission plan"} description={revise ? "The current version ends the day before the new one starts. Past entries keep the version they used." : undefined}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!valid || save.pending} onClick={() => void save.run()}>{save.pending ? "Saving…" : "Save plan"}</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Name" required className="sm:col-span-2"><Input value={v.name} onChange={(e) => set({ name: e.target.value })} /></Field>
        <Field label="Method"><Select value={v.kind} onChange={(e) => set({ kind: e.target.value as Plan["kind"] })}><option value="percent">Percentage</option><option value="fixed">Fixed per order</option><option value="tiered">Tiered</option></Select></Field>
        <Field label="Paid on"><Select value={v.basis} onChange={(e) => set({ basis: e.target.value })}><option value="booked">Booked orders</option><option value="invoiced">Invoiced</option><option value="collected">Collected payments</option></Select></Field>
        <Field label="Measured on"><Select value={v.measure} onChange={(e) => set({ measure: e.target.value })}><option value="revenue">Revenue</option><option value="gross_profit">Gross profit</option></Select></Field>
        {v.kind === "percent" && <Field label="Rate (%)" required><Input type="number" min={0} max={100} step="0.01" value={v.rate} onChange={(e) => set({ rate: e.target.value })} /></Field>}
        {v.kind === "fixed" && <Field label="Amount per order" required><MoneyInput value={v.fixed} onChange={(x) => set({ fixed: x })} /></Field>}
        <Field label="Effective from" required><Input type="date" value={v.from} onChange={(e) => set({ from: e.target.value })} /></Field>
        <Field label="Effective to"><Input type="date" value={v.to} onChange={(e) => set({ to: e.target.value })} /></Field>
      </div>
      {v.kind === "tiered" && <div className="mt-4"><p className="mb-2 text-sm font-medium">Tiers</p>
        <RowsEditor rows={tiers} onChange={setTiers} blank={() => ({ from: "0", to: "", rate: "" })} addLabel="Add tier" emptyText="Add at least one tier." render={(t, up) => (<>
          <Field label="From"><MoneyInput value={t.from} onChange={(x) => up({ from: x })} /></Field><Field label="To (blank = no limit)"><MoneyInput value={t.to} onChange={(x) => up({ to: x })} /></Field><Field label="Rate %"><Input type="number" min={0} max={100} step="0.01" value={t.rate} onChange={(e) => up({ rate: e.target.value })} /></Field></>)} /></div>}
      <div className="mt-4"><Checkbox label="Quota bonus (informational; an approver adds it as an adjustment)" checked={v.bonusOn} onChange={(e) => set({ bonusOn: e.target.checked })} />
        {v.bonusOn && <div className="mt-2 grid grid-cols-2 gap-3"><Field label="Attainment threshold %"><Input type="number" min={1} max={1000} value={v.bonusPct} onChange={(e) => set({ bonusPct: e.target.value })} /></Field><Field label="Bonus amount"><MoneyInput value={v.bonusAmt} onChange={(x) => set({ bonusAmt: x })} /></Field></div>}</div>
      {save.error && <p role="alert" className="mt-3 text-sm text-rose-500">{save.error.message}</p>}
    </Modal>
  );
}
