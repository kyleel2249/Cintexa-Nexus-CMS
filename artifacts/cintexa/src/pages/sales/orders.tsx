import { useState } from "react";
import { useLocation } from "wouter";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSales } from "@/context/SalesContext";
import { sales } from "@/lib/sales/api";
import { useSalesMutation } from "@/lib/sales/hooks";
import { useList, useListState } from "@/lib/sales/list";
import { ORDER_STATUSES, PAYMENT_STATUSES } from "@/lib/sales/enums";
import { dateOnly, money } from "@/lib/sales/format";
import { PageHeader, Panel, FilterBar, SearchBox, Select, DataTable, Pagination, StatusBadge, EmptyState, ErrorState, Skeleton, Tag, Modal, Field, Input, Textarea, Checkbox, type Column } from "@/components/sales/ui";
import { AccountPicker, OwnerSelect } from "@/components/sales/pickers";
import { DeleteOrderDialog } from "@/components/sales/PackageOrder";
import { useSalesQuery } from "@/lib/sales/hooks";
import { LinesEditor, blankLine, draftToBody, type LineDraft } from "@/components/sales/LinesEditor";

export interface OrderRow { id: number; number: string; status: string; account_id: number; account_name: string; owner_name: string | null; currency: string; total: string; paid_total: string; payment_status: string; invoice_status: string; inventory_status: string; booked_at: string | null; requires_approval: boolean }

export default function OrdersPage() {
  const { can } = useSales();
  const [, nav] = useLocation();
  const st = useListState(["status", "payment_status", "invoice_status", "owner_id", "overdue"]);
  const q = useList<OrderRow>("/orders", st);
  const [creating, setCreating] = useState(false);
  const [del, setDel] = useState<number | null>(null);
  const [audit, setAudit] = useState(false);
  const deleted = useSalesQuery<{ items: any[] }>(audit ? "/orders-deleted" : null);
  const columns: Column<OrderRow>[] = [
    { key: "n", header: "Order", sort: "number", render: (o) => <div><p className="font-medium">{o.number}</p><p className="text-xs text-muted-foreground">{o.account_name}</p></div> },
    { key: "s", header: "Status", render: (o) => <div className="flex flex-wrap gap-1"><StatusBadge status={o.status} />{o.requires_approval && o.status === "pending_approval" && <Tag>Awaiting approval</Tag>}</div> },
    { key: "p", header: "Payment", hideOnMobile: true, render: (o) => <StatusBadge status={o.payment_status} /> },
    { key: "i", header: "Invoice", hideOnMobile: true, render: (o) => <StatusBadge status={o.invoice_status} /> },
    { key: "t", header: "Total", sort: "total", align: "right", render: (o) => money(o.total, o.currency) },
    { key: "b", header: "Booked", sort: "booked", hideOnMobile: true, render: (o) => (o.booked_at ? dateOnly(o.booked_at) : "—") },
  ...(can("orders:delete") ? [{ key: "x", header: "", align: "right" as const, render: (o: OrderRow) => <Button size="sm" variant="ghost" className="text-rose-500" aria-label={`Delete order ${o.number}`} onClick={(e) => { e.stopPropagation(); setDel(o.id); }}>Delete</Button> }] : []),
  ];
  return (
    <>
      <PageHeader title="Sales orders" description="Orders are revenue once confirmed. Payments here are recorded manually unless a finance system is connected; invoice and stock states say so when no integration exists."
        actions={<>{can("orders:write") && <Button size="sm" variant="outline" onClick={() => nav("/sales/website-packages")}>Website package order</Button>}{can("orders:delete") && <Button size="sm" variant="outline" onClick={() => setAudit(true)}>Deleted orders</Button>}{can("orders:write") && <Button size="sm" onClick={() => setCreating(true)}><Plus className="mr-1.5 h-3.5 w-3.5" />New order</Button>}</>} />
      <FilterBar>
        <SearchBox value={st.q} onChange={st.setQ} placeholder="Search order number or account…" />
        <Select aria-label="Status" className="w-44" value={st.filters.status ?? ""} onChange={(e) => st.setFilter("status", e.target.value)}><option value="">Status: all</option>{ORDER_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</Select>
        <Select aria-label="Payment" className="w-40" value={st.filters.payment_status ?? ""} onChange={(e) => st.setFilter("payment_status", e.target.value)}><option value="">Payment: all</option>{PAYMENT_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</Select>
        <OwnerSelect value={st.filters.owner_id ?? ""} onChange={(v) => st.setFilter("owner_id", v)} />
        <Checkbox className="mb-0" label="Overdue payment" checked={st.filters.overdue === "true"} onChange={(e) => st.setFilter("overdue", e.target.checked ? "true" : "")} />
      </FilterBar>
      <Panel flush>
        {q.error && !q.data ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data ? <Skeleton rows={8} /> : (
          <><DataTable caption="Orders" columns={columns} rows={q.data.items} rowKey={(o) => o.id} sort={st.sort} onSort={st.setSort} onRowClick={(o) => nav(`/sales/orders/${o.id}`)} empty={<EmptyState title={st.hasFilters ? "No orders match" : "No orders yet"} description="Convert an accepted quotation or create an order directly." />} />
            <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={st.setPage} /></>
        )}
      </Panel>
      {creating && <CreateOrder onClose={() => setCreating(false)} />}
      {del !== null && <DeleteOrderDialog id={del} open onClose={() => setDel(null)} onDeleted={() => setDel(null)} />}
      <Modal open={audit} onClose={() => setAudit(false)} size="xl" title="Deleted orders (audit)" description="Every permanently deleted order is kept as evidence: who, when, why, and what had been paid. Payments are not refunded by deletion.">
        {!deleted.data ? <p className="text-sm text-muted-foreground">Loading…</p> : deleted.data.items.length === 0 ? <EmptyState title="No orders have been deleted" /> : (
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-1 pr-2">Order</th><th className="pr-2">Customer</th><th className="pr-2">Status then</th><th className="pr-2 text-right">Value</th><th className="pr-2 text-right">Received</th><th className="pr-2">Deleted</th><th>Reason</th></tr></thead>
            <tbody>{deleted.data.items.map((d) => <tr key={d.id} className="border-b align-top last:border-0"><td className="py-1 pr-2 font-medium">{d.number}</td><td className="pr-2">{d.account_name ?? "—"}</td><td className="pr-2">{String(d.status_at_deletion).replace(/_/g, " ")}</td><td className="pr-2 text-right tabular-nums">{money(d.total, d.currency)}</td><td className="pr-2 text-right tabular-nums">{money(d.paid_total, d.currency)} <span className="text-[11px] text-muted-foreground">({d.payment_count})</span></td><td className="pr-2 whitespace-nowrap">{d.deleted_by}<br /><span className="text-[11px] text-muted-foreground">{dateOnly(d.deleted_at)}</span></td><td>{d.reason}</td></tr>)}</tbody></table></div>
        )}
      </Modal>
    </>
  );
}

function CreateOrder({ onClose }: { onClose: () => void }) {
  const [, nav] = useLocation();
  const [acc, setAcc] = useState({ id: "", name: "" });
  const [lines, setLines] = useState<LineDraft[]>([blankLine()]);
  const [notes, setNotes] = useState("");
  const [booking, setBooking] = useState("");
  const [err, setErr] = useState("");
  const create = useSalesMutation(() => {
    if (!acc.id) throw new Error("Choose an account");
    const b = draftToBody(lines);
    if (b.error) throw new Error(b.error);
    return sales.post<{ id: number }>("/orders", { account_id: Number(acc.id), ...(booking ? { transaction_date: booking } : {}), ...(notes.trim() ? { notes: notes.trim() } : {}), lines: b.lines }, { idempotent: true });
  }, { invalidate: ["/orders"], success: "Draft order created", silentError: true, onError: (e) => setErr(e.issues.length ? e.issues.map((i) => `${i.path}: ${i.message}`).join(" · ") : e.message), onSuccess: (r) => nav(`/sales/orders/${(r as { id: number }).id}`) });
  return (
    <Modal open onClose={onClose} title="New sales order" size="xl" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={create.pending} onClick={() => { setErr(""); void create.run(); }}>Create draft</Button></>}>
      {err && <p role="alert" className="mb-3 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-500">{err}</p>}
      <Field label="Account" required><AccountPicker value={acc.id} initialName={acc.name} onChange={(id, name) => setAcc({ id, name })} /></Field>
      <Field label="Booking date" explain="Leave empty to book on the day you confirm. Past and future dates are allowed."><Input type="date" value={booking} onChange={(e) => setBooking(e.target.value)} /></Field>
      <h4 className="mb-2 text-sm font-semibold">Lines</h4>
      <LinesEditor rows={lines} onChange={setLines} />
      <Field label="Notes" className="mt-4"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
    </Modal>
  );
}
