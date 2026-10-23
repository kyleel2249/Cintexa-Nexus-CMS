import { useEffect, useState } from "react";
import { useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { useSales } from "@/context/SalesContext";
import { sales } from "@/lib/sales/api";
import { useSalesMutation, useSalesQuery } from "@/lib/sales/hooks";
import { FORECAST_CATEGORIES } from "@/lib/sales/enums";
import { dateOnly, dateTime, money, percent } from "@/lib/sales/format";
import { PageHeader, Panel, StatusBadge, QueryBoundary, DefinitionList, ConfirmModal, Modal, Field, Select, Input, MoneyInput, Tag, EmptyState } from "@/components/sales/ui";
import { FormModal, type FieldDef } from "@/components/sales/forms";
import { ActivityList, ActivityFormModal, type ActivityRow } from "@/components/sales/activity";
import { OwnerSelect } from "@/components/sales/pickers";
import { RowsEditor } from "@/components/sales/RowsEditor";
import type { Stage } from "./pipeline";
import { RecordAssistant } from "@/components/sales/agents/RecordAssistant";

const EDIT_FIELDS: FieldDef[] = [
  { name: "name", label: "Name", required: true, wide: true },
  { name: "amount", label: "Amount", type: "money", required: true },
  { name: "expected_close_date", label: "Expected close", type: "date" },
  { name: "forecast_category", label: "Forecast category", type: "select", options: FORECAST_CATEGORIES, required: true, hint: "Overrides are audited; leave as-is to follow the stage." },
  { name: "probability", label: "Probability %", type: "number", min: 0, max: 100, required: true },
  { name: "reset_probability", label: "Reset to the stage's default probability", type: "checkbox" },
  { name: "source", label: "Source" },
  { name: "next_action", label: "Next action" },
  { name: "next_action_date", label: "Next action date", type: "date" },
  { name: "buying_criteria", label: "Buying criteria", type: "textarea" },
  { name: "stakeholders", label: "Stakeholders", type: "textarea" },
  { name: "objections", label: "Objections", type: "textarea" },
  { name: "risks", label: "Risks", type: "textarea" },
  { name: "notes", label: "Notes", type: "textarea" },
];

interface Detail {
  opportunity: any; history: { id: string; from_stage: string | null; to_stage: string; amount: string; changed_by: string; note: string | null; at: string }[];
  changes: { id: number; field: string; old_value: string | null; new_value: string | null; changed_by: string; at: string }[];
  products: { id: number; product_id: number; name: string; sku: string; quantity: string; unit_price: string }[]; competitors: { id: number; competitor_id: number; name: string; outcome: string; notes: string | null }[];
  activities: ActivityRow[]; quotations?: { id: number; number: string; version: number; status: string; total: string; currency: string; validity_date: string }[];
}

export default function OpportunityDetailPage({ id }: { id: string }) {
  const { can } = useSales();
  const [, nav] = useLocation();
  const q = useSalesQuery<Detail>(`/opportunities/${id}`);
  const pipes = useSalesQuery<{ items: { id: number; stages: Stage[] }[] }>("/pipelines");
  const [dlg, setDlg] = useState<null | "edit" | "products" | "competitors" | "assign" | "delete" | "activity" | "lost">(null);
  const [assignTo, setAssignTo] = useState("");
  const [lostStage, setLostStage] = useState<Stage | null>(null);
  const [lostReason, setLostReason] = useState("");
  const inv = ["/opportunities", "/pipeline", "/dashboard", "/forecast"];
  const move = useSalesMutation((p: { stage_id: number; lost_reason?: string }) => sales.post(`/opportunities/${id}/move`, p), { invalidate: inv, success: "Stage updated", onSuccess: () => setDlg(null) });
  const assign = useSalesMutation(() => sales.post(`/opportunities/${id}/assign`, { owner_id: Number(assignTo) }), { invalidate: inv, success: "Reassigned", onSuccess: () => setDlg(null) });
  const del = useSalesMutation(() => sales.del(`/opportunities/${id}`), { invalidate: inv, success: "Opportunity archived", onSuccess: () => nav("/sales/pipeline") });

  return (
    <QueryBoundary q={q}>
      {(d) => {
        const o = d.opportunity;
        const stages = pipes.data?.items.find((p) => p.id === o.pipeline_id)?.stages ?? [];
        const open = o.status === "open";
        const canWrite = can("opportunities:write");
        return (
          <>
            <PageHeader back={{ href: "/sales/pipeline", label: "Pipeline" }} title={o.name}
              description={<span className="flex flex-wrap items-center gap-2">{o.number}<StatusBadge status={o.status} /><Link className="text-primary hover:underline" href={`/sales/accounts/${o.account_id}`}>{o.account_name}</Link>{o.stalled && <Tag>Stalled</Tag>}{o.overdue && <Tag>Past close date</Tag>}</span>}
              actions={<>
                {canWrite && <Button size="sm" variant="outline" onClick={() => setDlg("edit")}>Edit</Button>}
                {can("opportunities:assign") && <Button size="sm" variant="outline" onClick={() => setDlg("assign")}>Reassign</Button>}
                {can("quotations:write") && open && <Button size="sm" onClick={() => nav(`/sales/quotations?create=1&account_id=${o.account_id}&opportunity_id=${o.id}&account_name=${encodeURIComponent(o.account_name)}`)}>New quotation</Button>}
              </>} />
            {stages.length > 0 && (
              <Panel className="mb-6" title="Stage">
                <ol className="flex flex-wrap gap-1.5" aria-label="Pipeline stages">
                  {stages.map((s) => (
                    <li key={s.id}>
                      <button disabled={!canWrite || s.id === o.stage_id || move.pending} onClick={() => (s.kind === "lost" ? (setLostStage(s), setLostReason(""), setDlg("lost")) : void move.run({ stage_id: s.id }))}
                        aria-current={s.id === o.stage_id ? "step" : undefined}
                        className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${s.id === o.stage_id ? "border-primary bg-primary text-primary-foreground" : "hover:bg-secondary disabled:opacity-60"}`}>{s.name}</button>
                    </li>
                  ))}
                </ol>
                {move.error && <p role="alert" className="mt-2 text-sm text-amber-500">{move.error.message}</p>}
              </Panel>
            )}
            <div className="grid gap-6 lg:grid-cols-3">
              <div className="space-y-6 lg:col-span-2">
                <Panel title="Details">
                  <DefinitionList items={[
                    { label: "Amount", value: money(o.amount, o.currency) }, { label: "Probability", value: `${percent(Number(o.probability), 0)}${o.probability_overridden ? " (manual)" : ""}` },
                    { label: "Forecast category", value: <StatusBadge status={o.forecast_category} /> }, { label: "Expected close", value: o.expected_close_date ? dateOnly(o.expected_close_date) : null },
                    { label: "Owner", value: o.owner_name }, { label: "Stage since", value: dateTime(o.stage_entered_at) }, { label: "Source", value: o.source }, { label: "Next action", value: o.next_action ? `${o.next_action}${o.next_action_date ? ` (${dateOnly(o.next_action_date)})` : ""}` : null },
                    { label: "Close date changed", value: `${o.close_date_changes} time(s)` }, { label: o.status === "lost" ? "Lost reason" : "Closed", value: o.status === "lost" ? o.lost_reason : o.closed_at ? dateTime(o.closed_at) : null },
                  ]} />
                  {(["buying_criteria", "stakeholders", "objections", "risks", "notes"] as const).filter((k) => o[k]).map((k) => <div key={k} className="mt-3 border-t pt-3"><p className="text-xs font-medium capitalize text-muted-foreground">{k.replace("_", " ")}</p><p className="whitespace-pre-wrap text-sm">{o[k]}</p></div>)}
                </Panel>
                <Panel title="Products" actions={canWrite && open ? <Button size="sm" variant="outline" onClick={() => setDlg("products")}>Edit</Button> : undefined}>
                  {d.products.length === 0 ? <EmptyState title="No products listed" description="List what the customer is considering; quotations can start from these." /> : (
                    <ul className="divide-y text-sm">{d.products.map((p) => <li key={p.id} className="flex justify-between gap-3 py-2"><span>{p.name} <span className="text-xs text-muted-foreground">{p.sku}</span></span><span className="tabular-nums text-muted-foreground">{p.quantity} × {money(p.unit_price, o.currency)}</span></li>)}</ul>
                  )}
                </Panel>
                <Panel title="Activity" actions={can("activities:write") && open ? <Button size="sm" variant="outline" onClick={() => setDlg("activity")}>Add activity</Button> : undefined}><ActivityList items={d.activities} /></Panel>
                {d.quotations && <Panel title="Quotations">{d.quotations.length === 0 ? <EmptyState title="No quotations yet" /> : <ul className="divide-y text-sm">{d.quotations.map((x) => <li key={x.id} className="flex items-center justify-between gap-3 py-2"><Link className="text-primary hover:underline" href={`/sales/quotations/${x.id}`}>{x.number} v{x.version}</Link><span className="flex items-center gap-2"><StatusBadge status={x.status} /><span className="tabular-nums">{money(x.total, x.currency)}</span></span></li>)}</ul>}</Panel>}
              </div>
              <div className="space-y-6">
                <Panel title="Competitors" actions={canWrite && open && can("competitors:read") ? <Button size="sm" variant="outline" onClick={() => setDlg("competitors")}>Edit</Button> : undefined}>
                  {d.competitors.length === 0 ? <p className="text-sm text-muted-foreground">None recorded.</p> : <ul className="space-y-1 text-sm">{d.competitors.map((c) => <li key={c.id} className="flex justify-between"><span>{c.name}</span><StatusBadge status={c.outcome} /></li>)}</ul>}
                </Panel>
                <Panel title="Stage history"><ul className="space-y-1.5 text-xs">{d.history.map((h) => <li key={h.id}><span className="font-medium">{h.from_stage ? `${h.from_stage} → ` : ""}{h.to_stage}</span> <span className="text-muted-foreground">· {dateTime(h.at)} · {h.changed_by}{h.note ? ` — ${h.note}` : ""}</span></li>)}</ul></Panel>
                {d.changes.length > 0 && <Panel title="Field changes"><ul className="space-y-1.5 text-xs">{d.changes.map((c) => <li key={c.id}><span className="font-medium">{c.field}</span>: {c.old_value ?? "—"} → {c.new_value ?? "—"} <span className="text-muted-foreground">· {dateTime(c.at)} · {c.changed_by}</span></li>)}</ul></Panel>}
                {canWrite && <Button variant="ghost" size="sm" className="text-rose-500" onClick={() => setDlg("delete")}>Archive opportunity…</Button>}
              </div>
            </div>

            <div className="mt-6"><RecordAssistant type="opportunity" id={Number(id)} /></div>
            <FormModal open={dlg === "edit"} onClose={() => setDlg(null)} title="Edit opportunity" size="lg" fields={EDIT_FIELDS} nullEmpty initial={{ ...o, reset_probability: false }} submit={(b) => sales.patch(`/opportunities/${id}`, b)} success="Opportunity updated" invalidate={inv} />
            <ActivityFormModal open={dlg === "activity"} onClose={() => setDlg(null)} link={{ opportunity_id: Number(id), account_id: o.account_id }} />
            <Modal open={dlg === "assign"} onClose={() => setDlg(null)} title="Reassign opportunity" size="sm" footer={<><Button variant="outline" onClick={() => setDlg(null)}>Cancel</Button><Button disabled={!assignTo || assign.pending} onClick={() => void assign.run()}>Reassign</Button></>}>
              <Field label="New owner"><OwnerSelect value={assignTo} onChange={setAssignTo} allowAll={false} label="Owner" className="w-full" /></Field>
            </Modal>
            <Modal open={dlg === "lost"} onClose={() => setDlg(null)} title="Mark as lost" size="sm" footer={<><Button variant="outline" onClick={() => setDlg(null)}>Cancel</Button><Button variant="destructive" disabled={lostReason.trim().length < 3 || move.pending} onClick={() => lostStage && void move.run({ stage_id: lostStage.id, lost_reason: lostReason.trim() })}>Mark lost</Button></>}>
              <Field label="Why was it lost?" required><Input value={lostReason} onChange={(e) => setLostReason(e.target.value)} /></Field>
            </Modal>
            <ConfirmModal open={dlg === "delete"} onClose={() => setDlg(null)} title="Archive this opportunity?" message="It disappears from the pipeline and forecasts. The change is audited." confirmLabel="Archive" danger pending={del.pending} onConfirm={() => void del.run()} />
            {dlg === "products" && <ProductsEditor id={id} currency={o.currency} initial={d.products} onClose={() => setDlg(null)} />}
            {dlg === "competitors" && <CompetitorsEditor id={id} initial={d.competitors} onClose={() => setDlg(null)} />}
          </>
        );
      }}
    </QueryBoundary>
  );
}

function ProductsEditor({ id, initial, onClose }: { id: string; currency: string; initial: Detail["products"]; onClose: () => void }) {
  const list = useSalesQuery<{ items: { id: number; name: string; sku: string; base_price: string }[] }>("/products", { pageSize: 200, status: "active" });
  const [rows, setRows] = useState(initial.map((p) => ({ product_id: String(p.product_id), quantity: String(p.quantity), unit_price: String(p.unit_price) })));
  const save = useSalesMutation(() => sales.put(`/opportunities/${id}/products`, { products: rows.map((r) => ({ product_id: Number(r.product_id), quantity: Number(r.quantity), unit_price: r.unit_price })) }), { invalidate: [`/opportunities/${id}`], success: "Products saved", onSuccess: onClose });
  const bad = rows.some((r) => !r.product_id || !(Number(r.quantity) > 0) || r.unit_price === "");
  return (
    <Modal open onClose={onClose} title="Products on this opportunity" size="lg" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={bad || save.pending} onClick={() => void save.run()}>Save</Button></>}>
      <RowsEditor rows={rows} onChange={setRows} blank={() => ({ product_id: "", quantity: "1", unit_price: "" })} addLabel="Add product"
        render={(r, up) => (
          <>
            <Select aria-label="Product" value={r.product_id} onChange={(e) => { const p = list.data?.items.find((x) => String(x.id) === e.target.value); up({ product_id: e.target.value, unit_price: r.unit_price || p?.base_price || "" }); }}><option value="">Select product…</option>{list.data?.items.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}</Select>
            <Input aria-label="Quantity" type="number" min="0.0001" step="any" value={r.quantity} onChange={(e) => up({ quantity: e.target.value })} />
            <MoneyInput aria-label="Unit price" value={r.unit_price} onChange={(v) => up({ unit_price: v })} />
          </>
        )} />
      {save.error && <p role="alert" className="mt-2 text-sm text-rose-500">{save.error.message}</p>}
    </Modal>
  );
}

function CompetitorsEditor({ id, initial, onClose }: { id: string; initial: Detail["competitors"]; onClose: () => void }) {
  const list = useSalesQuery<{ items: { id: number; name: string }[] }>("/competitors");
  const [rows, setRows] = useState(initial.map((c) => ({ competitor_id: String(c.competitor_id), outcome: c.outcome, notes: c.notes ?? "" })));
  const save = useSalesMutation(() => sales.put(`/opportunities/${id}/competitors`, { competitors: rows.map((r) => ({ competitor_id: Number(r.competitor_id), outcome: r.outcome, notes: r.notes || undefined })) }), { invalidate: [`/opportunities/${id}`, "/competitors"], success: "Competitors saved", onSuccess: onClose });
  useEffect(() => undefined, []);
  return (
    <Modal open onClose={onClose} title="Competitors on this deal" size="lg" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={rows.some((r) => !r.competitor_id) || save.pending} onClick={() => void save.run()}>Save</Button></>}>
      <RowsEditor rows={rows} onChange={setRows} blank={() => ({ competitor_id: "", outcome: "present", notes: "" })} addLabel="Add competitor" emptyText="No competitors recorded."
        render={(r, up) => (
          <>
            <Select aria-label="Competitor" value={r.competitor_id} onChange={(e) => up({ competitor_id: e.target.value })}><option value="">Select…</option>{list.data?.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
            <Select aria-label="Outcome" value={r.outcome} onChange={(e) => up({ outcome: e.target.value })}><option value="present">Present</option><option value="won_against">We won against</option><option value="lost_to">We lost to</option></Select>
            <Input aria-label="Notes" placeholder="Notes" value={r.notes} onChange={(e) => up({ notes: e.target.value })} />
          </>
        )} />
    </Modal>
  );
}
