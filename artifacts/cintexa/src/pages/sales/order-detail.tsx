import { Link } from "wouter";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useSales } from "@/context/SalesContext";
import { sales } from "@/lib/sales/api";
import { useSalesMutation, useSalesQuery } from "@/lib/sales/hooks";
import { PAYMENT_METHODS } from "@/lib/sales/enums";
import { dateOnly, dateTime, money } from "@/lib/sales/format";
import { PageHeader, Panel, StatusBadge, QueryBoundary, DefinitionList, ConfirmModal, Modal, Field, Input, Select, MoneyInput, DataTable, Tag, EmptyState } from "@/components/sales/ui";
import { FormModal } from "@/components/sales/forms";
import { todayIso } from "@/lib/sales/format";

interface Line { id: number; description: string; sku?: string; quantity: string; fulfilled_quantity: string; returned_quantity: string; unit_price: string; total: string; discount_percent: string }
interface Detail {
  order: any; lines: Line[]; payments: { id: string; amount: string; method: string; reference: string | null; received_on: string; source: string; status: string; recorded_by: string; at: string }[];
  fulfilments: { id: number; line_id: number; quantity: string; reference: string | null; source: string; recorded_by: string; at: string }[];
  returns: { id: number; line_id: number; quantity: string; reason: string; credit_amount: string; recorded_by: string; at: string }[];
  integrations: { kind: string; status: string; attempts: number; last_error: string | null; created_at: string }[];
  account: { id: number; name: string; number: string }; outstanding: string; statusNotes: { inventory?: string; invoice?: string };
}
type Dlg = null | "confirm" | "approve" | "reject" | "invoice" | "fulfil" | "complete" | "payment" | "return" | "cancel" | { reverse: string };

export default function OrderDetailPage({ id }: { id: string }) {
  const { can } = useSales();
  const q = useSalesQuery<Detail>(`/orders/${id}`);
  const [dlg, setDlg] = useState<Dlg>(null);
  const inv = ["/orders", "/dashboard", "/commissions", "/accounts"];
  const simple = (path: string, success: string, body?: unknown) => useSalesMutation(() => sales.post(`/orders/${id}/${path}`, body ?? {}), { invalidate: inv, success, onSuccess: () => setDlg(null) });
  const confirm = simple("confirm", "Order confirmed");
  const approve = simple("approve", "Order approved");
  const invoice = simple("request-invoice", "Invoice requested");
  const complete = simple("complete", "Order completed");
  const cancel = useSalesMutation((reason: string) => sales.post(`/orders/${id}/cancel`, { reason }), { invalidate: inv, success: "Order cancelled", onSuccess: () => setDlg(null) });
  const reject = useSalesMutation((comment: string) => sales.post(`/orders/${id}/reject-approval`, { comment }), { invalidate: inv, success: "Approval rejected", onSuccess: () => setDlg(null) });
  const reverse = useSalesMutation((p: { pid: string; reason: string }) => sales.post(`/orders/${id}/payments/${p.pid}/reverse`, { reason: p.reason }), { invalidate: inv, success: "Payment reversed", onSuccess: () => setDlg(null) });

  return (
    <QueryBoundary q={q}>
      {(d) => {
        const o = d.order;
        const st = o.status as string;
        const live = !["draft", "cancelled"].includes(st);
        return (
          <>
            <PageHeader back={{ href: "/sales/orders", label: "Orders" }} title={o.number}
              description={<span className="flex flex-wrap items-center gap-2"><StatusBadge status={st} /><StatusBadge status={o.payment_status} label={`Payment: ${o.payment_status}`} /><Link className="text-primary hover:underline" href={`/sales/accounts/${d.account.id}`}>{d.account.name}</Link></span>}
              actions={<>
                {can("orders:write") && st === "draft" && <Button size="sm" disabled={confirm.pending} onClick={() => void confirm.run()}>Confirm order</Button>}
                {can("orders:approve") && st === "pending_approval" && <><Button size="sm" disabled={approve.pending} onClick={() => void approve.run()}>Approve</Button><Button size="sm" variant="outline" onClick={() => setDlg("reject")}>Reject</Button></>}
                {can("orders:fulfil") && live && o.invoice_status !== "issued" && <Button size="sm" variant="outline" disabled={invoice.pending} onClick={() => void invoice.run()}>Request invoice</Button>}
                {can("orders:fulfil") && ["confirmed", "processing", "partially_fulfilled"].includes(st) && <Button size="sm" variant="outline" onClick={() => setDlg("fulfil")}>Record fulfilment</Button>}
                {can("orders:fulfil") && ["fulfilled", "partially_fulfilled", "confirmed", "processing"].includes(st) && <Button size="sm" variant="outline" disabled={complete.pending} onClick={() => void complete.run()}>Complete</Button>}
                {can("payments:record") && live && <Button size="sm" onClick={() => setDlg("payment")}>Record payment</Button>}
                {can("orders:fulfil") && live && <Button size="sm" variant="outline" onClick={() => setDlg("return")}>Record return</Button>}
                {can("orders:cancel") && !["cancelled", "completed"].includes(st) && <Button size="sm" variant="ghost" className="text-rose-500" onClick={() => setDlg("cancel")}>Cancel order</Button>}
              </>} />
            {(confirm.error || approve.error || invoice.error || complete.error) && <p role="alert" className="mb-4 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">{(confirm.error ?? approve.error ?? invoice.error ?? complete.error)!.message}</p>}
            {st === "pending_approval" && o.approval_reasons?.length > 0 && <Panel className="mb-4" title="Approval needed because"><ul className="list-disc pl-5 text-sm">{(o.approval_reasons as { message: string }[]).map((r, i) => <li key={i}>{r.message}</li>)}</ul></Panel>}
            {(d.statusNotes.inventory || d.statusNotes.invoice) && <p className="mb-4 rounded-md border bg-secondary/40 px-3 py-2 text-sm text-muted-foreground">{[d.statusNotes.inventory, d.statusNotes.invoice].filter(Boolean).join(" ")}</p>}
            <div className="grid gap-6 lg:grid-cols-3">
              <div className="space-y-6 lg:col-span-2">
                <Panel title="Lines" flush>
                  <DataTable caption="Order lines" rows={d.lines} rowKey={(l) => l.id} columns={[
                    { key: "d", header: "Item", render: (l) => <div><p>{l.description}</p>{l.sku && <p className="text-xs text-muted-foreground">{l.sku}</p>}</div> },
                    { key: "q", header: "Ordered", align: "right", render: (l) => Number(l.quantity) },
                    { key: "f", header: "Fulfilled", align: "right", hideOnMobile: true, render: (l) => Number(l.fulfilled_quantity) },
                    { key: "r", header: "Returned", align: "right", hideOnMobile: true, render: (l) => Number(l.returned_quantity) },
                    { key: "t", header: "Total", align: "right", render: (l) => money(l.total, o.currency) },
                  ]} />
                  <dl className="space-y-1 border-t px-4 py-3 text-sm">
                    <div className="flex justify-between"><dt className="text-muted-foreground">Net</dt><dd className="tabular-nums">{money(o.net_total, o.currency)}</dd></div>
                    <div className="flex justify-between"><dt className="text-muted-foreground">Tax</dt><dd className="tabular-nums">{money(o.tax_total, o.currency)}</dd></div>
                    <div className="flex justify-between border-t pt-1 text-base font-semibold"><dt>Total</dt><dd className="tabular-nums">{money(o.total, o.currency)}</dd></div>
                    {Number(o.returned_total) > 0 && <div className="flex justify-between text-muted-foreground"><dt>Returned</dt><dd className="tabular-nums">−{money(o.returned_total, o.currency)}</dd></div>}
                    <div className="flex justify-between text-muted-foreground"><dt>Paid</dt><dd className="tabular-nums">{money(o.paid_total, o.currency)}</dd></div>
                    <div className="flex justify-between font-medium"><dt>Outstanding</dt><dd className="tabular-nums">{money(d.outstanding, o.currency)}</dd></div>
                    {o.gross_profit != null && <div className="flex justify-between text-xs text-muted-foreground"><dt>Gross profit</dt><dd>{money(o.gross_profit, o.currency)}</dd></div>}
                  </dl>
                </Panel>
                <Panel title="Payments" description="Recorded by people here — not verified against a bank or payment gateway.">
                  {d.payments.length === 0 ? <EmptyState title="No payments recorded" /> : (
                    <ul className="divide-y text-sm">{d.payments.map((p) => (
                      <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                        <div><p className={p.status === "reversed" ? "line-through" : ""}>{money(p.amount, o.currency)} · {p.method.replace(/_/g, " ")}{p.reference ? ` · ${p.reference}` : ""}</p><p className="text-xs text-muted-foreground">{dateOnly(p.received_on)} · {p.recorded_by} · <Tag>{p.source === "manual" ? "manual, unverified" : p.source}</Tag></p></div>
                        {p.status === "reversed" ? <StatusBadge status="voided" label="Reversed" /> : can("payments:record") ? <Button size="sm" variant="ghost" onClick={() => setDlg({ reverse: p.id })}>Reverse</Button> : null}
                      </li>
                    ))}</ul>
                  )}
                </Panel>
                {(d.fulfilments.length > 0 || d.returns.length > 0) && (
                  <Panel title="Fulfilment & returns"><ul className="space-y-1.5 text-sm">
                    {d.fulfilments.map((f) => <li key={`f${f.id}`}>Fulfilled {Number(f.quantity)} × {d.lines.find((l) => l.id === f.line_id)?.description ?? "line"} <span className="text-xs text-muted-foreground">· {dateTime(f.at)} · {f.recorded_by}{f.reference ? ` · ${f.reference}` : ""}</span></li>)}
                    {d.returns.map((r) => <li key={`r${r.id}`}>Returned {Number(r.quantity)} × {d.lines.find((l) => l.id === r.line_id)?.description ?? "line"} — {r.reason} <span className="text-xs text-muted-foreground">· credit {money(r.credit_amount, o.currency)} · {dateTime(r.at)}</span></li>)}
                  </ul></Panel>
                )}
              </div>
              <div className="space-y-6">
                <Panel title="Details"><DefinitionList items={[{ label: "Booked", value: o.booked_at ? dateTime(o.booked_at) : "Not yet confirmed" }, { label: "Invoice", value: `${o.invoice_status}${o.invoice_ref ? ` (${o.invoice_ref})` : ""}` }, { label: "Invoice due", value: o.invoice_due_on ? dateOnly(o.invoice_due_on) : null }, { label: "Stock", value: o.inventory_status }, { label: "Requested delivery", value: o.requested_delivery_on ? dateOnly(o.requested_delivery_on) : null }, { label: "Payment terms", value: `${o.payment_terms_days} days` }, { label: "Shipping", value: o.shipping_address }, { label: "Billing", value: o.billing_address }, { label: "Notes", value: o.notes }, { label: "Cancelled", value: o.cancelled_at ? `${dateTime(o.cancelled_at)} — ${o.cancel_reason ?? ""}` : null }]} /></Panel>
                {d.integrations.length > 0 && <Panel title="Integration queue"><ul className="space-y-1 text-xs">{d.integrations.map((i, n) => <li key={n}><StatusBadge status={i.status} /> {i.kind}{i.last_error ? ` — ${i.last_error}` : ""}</li>)}</ul></Panel>}
              </div>
            </div>

            <PaymentModal open={dlg === "payment"} onClose={() => setDlg(null)} id={id} outstanding={d.outstanding} />
            {dlg === "fulfil" && <LineQtyModal id={id} lines={d.lines.map((l) => ({ ...l, room: String(Number(l.quantity) - Number(l.fulfilled_quantity)) }))} kind="fulfil" onClose={() => setDlg(null)} />}
            <FormModal open={dlg === "return"} onClose={() => setDlg(null)} title="Record return" description="Credits the returned value against the order and reduces revenue and commission." submitLabel="Record return" success="Return recorded" invalidate={inv}
              fields={[{ name: "line_id", label: "Line", type: "select", required: true, wide: true, options: d.lines.map((l) => ({ value: String(l.id), label: `${l.description} (fulfilled ${Number(l.fulfilled_quantity)}, returned ${Number(l.returned_quantity)})` })) }, { name: "quantity", label: "Quantity", type: "number", min: 0.0001, required: true }, { name: "reason", label: "Reason", required: true, wide: true }]}
              submit={(b) => sales.post(`/orders/${id}/returns`, { ...b, line_id: Number(b.line_id) })} />
            <ConfirmModal open={dlg === "cancel"} onClose={() => setDlg(null)} title="Cancel order" message="Cancelled orders are excluded from revenue; commission is reversed." confirmLabel="Cancel order" danger reasonLabel="Reason" reasonRequired pending={cancel.pending} onConfirm={(r) => void cancel.run(r ?? "")} />
            <ConfirmModal open={dlg === "reject"} onClose={() => setDlg(null)} title="Reject approval" confirmLabel="Reject" reasonLabel="Why is it rejected?" reasonRequired pending={reject.pending} onConfirm={(r) => void reject.run(r ?? "")} />
            <ConfirmModal open={typeof dlg === "object" && dlg !== null && "reverse" in dlg} onClose={() => setDlg(null)} title="Reverse payment" message="The payment stays in the record, marked reversed." confirmLabel="Reverse" danger reasonLabel="Reason" reasonRequired pending={reverse.pending} onConfirm={(r) => typeof dlg === "object" && dlg && "reverse" in dlg && void reverse.run({ pid: dlg.reverse, reason: r ?? "" })} />
          </>
        );
      }}
    </QueryBoundary>
  );
}

function PaymentModal({ open, onClose, id, outstanding }: { open: boolean; onClose: () => void; id: string; outstanding: string }) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("bank_transfer");
  const [reference, setReference] = useState("");
  const [on, setOn] = useState(todayIso());
  const m = useSalesMutation(() => sales.post(`/orders/${id}/payments`, { amount, method, ...(reference ? { reference } : {}), received_on: on }, { idempotent: true }), { invalidate: ["/orders", "/dashboard", "/commissions"], success: "Payment recorded", onSuccess: () => { setAmount(""); setReference(""); onClose(); } });
  return (
    <Modal open={open} onClose={onClose} title="Record payment" size="sm" description={`Outstanding: ${money(outstanding)}. This records what you were told or saw — it is not verified with a bank.`} footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!amount || Number(amount) <= 0 || m.pending} onClick={() => void m.run()}>Record</Button></>}>
      <Field label="Amount" required><MoneyInput value={amount} onChange={setAmount} /></Field>
      <Field label="Method"><Select value={method} onChange={(e) => setMethod(e.target.value)}>{PAYMENT_METHODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</Select></Field>
      <Field label="Reference"><Input value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
      <Field label="Received on"><Input type="date" value={on} onChange={(e) => setOn(e.target.value)} /></Field>
      {m.error && <p role="alert" className="text-sm text-rose-500">{m.error.message}</p>}
    </Modal>
  );
}

function LineQtyModal({ id, lines, onClose }: { id: string; lines: (Line & { room: string })[]; kind: "fulfil"; onClose: () => void }) {
  const [qty, setQty] = useState<Record<number, string>>({});
  const [reference, setReference] = useState("");
  const picked = lines.filter((l) => Number(qty[l.id]) > 0);
  const m = useSalesMutation(() => sales.post(`/orders/${id}/fulfil`, { reference: reference || undefined, lines: picked.map((l) => ({ line_id: l.id, quantity: Number(qty[l.id]) })) }), { invalidate: ["/orders"], success: "Fulfilment recorded", onSuccess: onClose });
  return (
    <Modal open onClose={onClose} title="Record fulfilment" description="Enter the quantity delivered per line. No stock system is updated unless one is connected." footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={picked.length === 0 || m.pending} onClick={() => void m.run()}>Record</Button></>}>
      <ul className="space-y-2">{lines.map((l) => <li key={l.id} className="flex items-center justify-between gap-3 text-sm"><span className="min-w-0 truncate">{l.description} <span className="text-xs text-muted-foreground">(remaining {Number(l.room)})</span></span><Input aria-label={`Quantity for ${l.description}`} className="w-24" type="number" min="0" max={l.room} step="any" value={qty[l.id] ?? ""} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} /></li>)}</ul>
      <Field label="Delivery reference" className="mt-3"><Input value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
      {m.error && <p role="alert" className="text-sm text-rose-500">{m.error.message}</p>}
    </Modal>
  );
}
