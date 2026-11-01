import { useState } from "react";
import { FileDown, Trash2, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSales } from "@/context/SalesContext";
import { sales } from "@/lib/sales/api";
import { useSalesMutation, useSalesQuery } from "@/lib/sales/hooks";
import { dateOnly, money, todayIso } from "@/lib/sales/format";
import { Panel, StatusBadge, Modal, Field, Input, Textarea, Select, Checkbox, EmptyState, Tag, QueryBoundary } from "./ui";
import { Term } from "./Hint";
import { ORDER_DOCS, buildOrderDoc, docFilename, type Agreement, type DocKey } from "@/lib/sales/order-docs";

const INV = ["/orders", "/dashboard", "/commissions", "/accounts", "/fx"];
const LBL: Record<string, string> = { paid: "Paid", partial: "Partly paid", pending: "Pending", overdue: "Overdue" };

/** Booking date: the date the sale is recorded against in reports. Any date is allowed; creation, confirmation and payment times never change. */
export function BookingDate({ id, current, locked }: { id: number; current: string | null; locked?: boolean }) {
  const { can } = useSales();
  const [open, setOpen] = useState(false); const [date, setDate] = useState(current ?? todayIso()); const [reason, setReason] = useState("");
  const m = useSalesMutation(() => sales.patch(`/orders/${id}/transaction-date`, { transaction_date: date, reason: reason || undefined }), { invalidate: INV, success: "Booking date updated", onSuccess: () => setOpen(false) });
  if (!can("orders:write") || locked) return null;
  return (<>
    <Button size="sm" variant="outline" onClick={() => setOpen(true)}><CalendarDays className="mr-1.5 h-3.5 w-3.5" />Booking date</Button>
    <Modal open={open} onClose={() => setOpen(false)} title="Booking date" size="sm" description="Reports and revenue use this date. It can be in the past, today or the future, at any stage. Payment dates, the entry time and the confirmation time do not change." footer={<><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={m.pending || !date} onClick={() => void m.run()}>Save date</Button></>}>
      <Field label="Booking date" required explain="You can type the date or pick it from the calendar."><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <Field label="Reason (recorded in the audit log)"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. the sale was agreed on this date" /></Field>
      {m.error && <p role="alert" className="text-sm text-rose-500">{m.error.message}</p>}
    </Modal>
  </>);
}

/** The customer agreement: frozen package snapshot, negotiated changes, requirements and terms. */
export function AgreementPanel({ a }: { a: Agreement }) {
  const o = a.order, k = a.package;
  if (!k) return null;
  const mods = k.modifications;
  return (
    <Panel title="Customer agreement" description="The package exactly as it was agreed at booking. Later catalogue changes never alter it.">
      <div className="mb-3 flex flex-wrap items-center gap-2"><span className="text-base font-semibold">{k.snapshot.name}</span><Tag>{money(k.agreed_price, o.currency)}</Tag>{k.agreed_price !== k.original_price && <span className="text-xs text-muted-foreground">catalogue price {money(k.original_price, o.currency)}</span>}</div>
      <p className="mb-2 text-sm text-muted-foreground">{k.snapshot.description}</p>
      <ul className="mb-3 space-y-1 text-sm">{k.snapshot.features.map((f) => <li key={f.text} className={f.included ? "" : "text-muted-foreground line-through"}>✓ {f.text}</li>)}</ul>
      {mods.length > 0 && <div className="mb-3"><p className="mb-1 text-xs font-medium uppercase text-muted-foreground">Negotiated changes</p><ul className="list-disc space-y-0.5 pl-5 text-sm">{mods.map((m: any, i: number) => <li key={i}>{m.type === "price_change" ? `Agreed price ${money(m.from, o.currency)} → ${money(m.to, o.currency)}` : m.type === "discount_percent" ? `Discount ${m.value}%` : m.type === "discount_amount" ? `Discount ${money(m.value, o.currency)}` : m.type === "extra_item" ? `Additional: ${m.description} (${Number(m.quantity)} × ${money(m.unit_price, o.currency)})` : m.type === "feature_removed" ? `Feature #${m.position} removed` : `Payment terms changed: upfront ${money(m.upfront, o.currency)}, ${m.instalments} instalments`}</li>)}</ul></div>}
      {k.requirements && <p className="mb-2 text-sm"><span className="font-medium">Project requirements: </span>{k.requirements}</p>}
      {k.custom_terms && <p className="mb-2 text-sm"><span className="font-medium">Additional terms: </span>{k.custom_terms}</p>}
      {k.snapshot.terms && <p className="text-xs text-muted-foreground">{k.snapshot.terms}</p>}
    </Panel>
  );
}

/** Payment plan + live tracking. The plan is the schedule of what is expected; payments are separate records allocated to it in order. */
export function PaymentPlanPanel({ a, onChanged }: { a: Agreement; onChanged: () => void }) {
  const { can } = useSales(); const o = a.order, s = a.summary; const id = o.id;
  const [dlg, setDlg] = useState<null | "plan" | { seq: number }>(null);
  const [pct, setPct] = useState("50"); const [n, setN] = useState(String(Math.max(1, s.instalmentsTotal))); const [first, setFirst] = useState(""); const [reason, setReason] = useState("");
  const [due, setDue] = useState(""); const [note, setNote] = useState("");
  const canEdit = o.status !== "cancelled" && (a.order.confirmed_at ? can("orders:approve") || can("payments:record") : can("orders:write"));
  const plan = useSalesMutation(() => sales.put(`/orders/${id}/payment-plan`, { upfront_percent: Number(pct), instalments: Number(n), ...(first ? { first_due_on: first } : {}), reason: reason || undefined }), { invalidate: INV, success: "Payment plan updated", onSuccess: () => { setDlg(null); onChanged(); } });
  const resched = useSalesMutation((seq: number) => sales.patch(`/orders/${id}/instalments/${seq}`, { due_on: due || undefined, note: note || undefined }), { invalidate: INV, success: "Payment rescheduled", onSuccess: () => { setDlg(null); onChanged(); } });
  if (s.schedule.length === 0) return <Panel title="Payment plan"><EmptyState title="No payment plan" description="This order was not created from a package. Record payments as usual." /></Panel>;
  return (
    <Panel title="Payment plan & tracking" description="Early, partial and extra payments settle the schedule in order. Recorded payments are never altered by plan changes." actions={canEdit && <Button size="sm" variant="outline" onClick={() => { setPct(String(Math.round(Number(s.upfrontExpected) / Number(s.total) * 10000) / 100)); setDlg("plan"); }}>Change plan</Button>}>
      <div className="mb-3"><div className="mb-1 flex justify-between text-xs"><span><Term term="Outstanding">Paid</Term> {money(s.totalPaid, o.currency)} of {money(s.total, o.currency)}</span><span className="tabular-nums">{s.completionPercent}%</span></div>
        <div className="h-2.5 overflow-hidden rounded bg-secondary" role="progressbar" aria-valuenow={s.completionPercent} aria-valuemin={0} aria-valuemax={100} aria-label="Payment completion"><div className="h-full bg-emerald-500 transition-all" style={{ width: `${s.completionPercent}%` }} /></div></div>
      <dl className="mb-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
        {[["Agreed value", money(s.total, o.currency)], ["Upfront expected", money(s.upfrontExpected, o.currency)], ["Upfront received", money(s.upfrontReceived, o.currency)], ["Total paid", money(s.totalPaid, o.currency)], ["Outstanding", money(s.outstanding, o.currency)], ["Next payment due", s.nextDue ? `${s.nextDue.label} · ${dateOnly(s.nextDue.due_on)}` : "Nothing due"], ["Instalments paid", `${s.instalmentsPaid} of ${s.instalmentsTotal}`], ["Instalments pending", String(s.instalmentsPending)], ["Overdue payments", String(s.instalmentsOverdue)]].map(([k, v]) => <div key={k}><dt className="text-xs text-muted-foreground">{k}</dt><dd className={`font-medium tabular-nums ${k === "Overdue payments" && Number(v) > 0 ? "text-rose-500" : ""}`}>{v}</dd></div>)}
      </dl>
      {!s.planMatchesTotal && <p role="alert" className="mb-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs">The scheduled amounts ({money(s.planTotal, o.currency)}) no longer match the order total ({money(s.total, o.currency)}). Use Change plan to rebuild the schedule.</p>}
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-1.5 pr-2">Payment</th><th className="pr-2">Due</th><th className="pr-2 text-right">Amount</th><th className="pr-2 text-right">Paid</th><th className="pr-2">Status</th><th /></tr></thead>
        <tbody>{s.schedule.map((i) => <tr key={i.seq} className="border-b last:border-0"><td className="py-1.5 pr-2">{i.label}{i.note && <span className="block text-[11px] text-muted-foreground">{i.note}</span>}</td><td className="pr-2 whitespace-nowrap">{dateOnly(i.due_on)}</td><td className="pr-2 text-right tabular-nums">{money(i.amount, o.currency)}</td><td className="pr-2 text-right tabular-nums">{money(i.allocated, o.currency)}</td><td className="pr-2"><StatusBadge status={i.status === "overdue" ? "overdue" : i.status === "paid" ? "paid" : i.status === "partial" ? "partial" : "pending"} label={LBL[i.status]} /></td><td className="text-right">{canEdit && i.status !== "paid" && <Button size="sm" variant="ghost" onClick={() => { setDue(i.due_on); setNote(i.note ?? ""); setDlg({ seq: i.seq }); }}>Reschedule</Button>}</td></tr>)}</tbody></table></div>
      <Modal open={dlg === "plan"} onClose={() => setDlg(null)} title="Change payment plan" size="sm" description="The schedule is rebuilt for the order total. The last payment absorbs rounding so the plan always equals the total exactly." footer={<><Button variant="outline" onClick={() => setDlg(null)}>Cancel</Button><Button disabled={plan.pending} onClick={() => void plan.run()}>Rebuild schedule</Button></>}>
        <Field label="Upfront percentage"><Input type="number" min={0} max={100} step="0.01" value={pct} onChange={(e) => setPct(e.target.value)} /></Field>
        <Field label="Number of instalments"><Input type="number" min={0} max={60} value={n} onChange={(e) => setN(e.target.value)} /></Field>
        <Field label="First instalment date (optional)"><Input type="date" value={first} onChange={(e) => setFirst(e.target.value)} /></Field>
        <Field label="Reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        {plan.error && <p role="alert" className="text-sm text-rose-500">{plan.error.message}</p>}
      </Modal>
      <Modal open={typeof dlg === "object" && dlg !== null} onClose={() => setDlg(null)} title="Reschedule payment" size="sm" footer={<><Button variant="outline" onClick={() => setDlg(null)}>Cancel</Button><Button disabled={resched.pending} onClick={() => typeof dlg === "object" && dlg && void resched.run(dlg.seq)}>Save</Button></>}>
        <Field label="New due date"><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. customer asked for more time" /></Field>
        {resched.error && <p role="alert" className="text-sm text-rose-500">{resched.error.message}</p>}
      </Modal>
    </Panel>
  );
}

/** Download any of the eight documents, generated from the saved order. */
export function DocumentsMenu({ a }: { a: Agreement }) {
  const [open, setOpen] = useState(false); const [err, setErr] = useState<string | null>(null);
  const rec = a.payments.filter((p) => p.status === "recorded");
  const go = (key: DocKey, paymentId?: string | number) => { try { setErr(null); const p = buildOrderDoc(key, a, { paymentId }); p.save(docFilename(key, a).replace(".pdf", paymentId !== undefined ? `-${paymentId}.pdf` : ".pdf")); } catch (e: any) { setErr(e?.message ?? "Could not create the document"); } };
  return (<>
    <Button size="sm" variant="outline" onClick={() => setOpen(true)}><FileDown className="mr-1.5 h-3.5 w-3.5" />Documents</Button>
    <Modal open={open} onClose={() => setOpen(false)} title="Download documents" size="sm" description="PDFs are generated from the saved order, so they always match the records.">
      <ul className="space-y-1.5">{ORDER_DOCS.filter((d) => d.key !== "receipt").map((d) => <li key={d.key}><Button variant="outline" className="w-full justify-start" disabled={d.needsPackage && !a.package} onClick={() => go(d.key)}><FileDown className="mr-2 h-3.5 w-3.5" />{d.label}</Button></li>)}
        <li><p className="mt-2 text-xs font-medium uppercase text-muted-foreground">Payment receipts</p>{rec.length === 0 ? <p className="text-xs text-muted-foreground">No payments recorded yet.</p> : rec.map((p, i) => <Button key={p.id} variant="outline" className="mt-1 w-full justify-start" onClick={() => go("receipt", p.id)}><FileDown className="mr-2 h-3.5 w-3.5" />Receipt {i + 1}: {money(p.amount, a.order.currency)} · {dateOnly(p.received_on)}</Button>)}</li></ul>
      {err && <p role="alert" className="mt-2 text-sm text-rose-500">{err}</p>}
    </Modal>
  </>);
}

interface Impact { number: string; status: string; customer: string | null; currency: string; total: string; paid_total: string; payment_status: string; lines: number; payments: number; instalments: number; commissionEntries: number; approvedOrPaidCommissions: number; documents: number; needsPaymentAcknowledgement: boolean; needsConfirmedAcknowledgement: boolean }
/** Permanent deletion with the full set of safeguards. Deleting is NOT refunding: the dialog says so. */
export function DeleteOrderDialog({ id, open, onClose, onDeleted }: { id: number; open: boolean; onClose: () => void; onDeleted: () => void }) {
  const q = useSalesQuery<Impact>(open ? `/orders/${id}/deletion-impact` : null);
  const [typed, setTyped] = useState(""); const [reason, setReason] = useState(""); const [ackPay, setAckPay] = useState(false); const [ackConf, setAckConf] = useState(false); const [ackComm, setAckComm] = useState(false);
  const m = useSalesMutation((i: Impact) => sales.post(`/orders/${id}/delete`, { reason, confirm_number: typed, acknowledge_payments: ackPay || undefined, acknowledge_confirmed: ackConf || undefined, acknowledge_commissions: ackComm || undefined }), { invalidate: INV, success: "Order permanently deleted", onSuccess: () => { onClose(); onDeleted(); } });
  return (
    <Modal open={open} onClose={onClose} title="Permanently delete order" size="md" description="This cannot be undone. A deletion record (who, when, why and a full snapshot) is kept for audit.">
      <QueryBoundary q={q}>{(i) => (<>
        <dl className="mb-3 grid grid-cols-2 gap-x-4 gap-y-1 rounded-md border bg-secondary/30 p-3 text-sm">
          {[["Order", i.number], ["Customer", i.customer ?? "—"], ["Status", i.status.replace(/_/g, " ")], ["Payment status", i.payment_status], ["Order value", money(i.total, i.currency)], ["Payments received", `${money(i.paid_total, i.currency)} (${i.payments})`], ["Lines / schedule items", `${i.lines} / ${i.instalments}`], ["Commission entries", String(i.commissionEntries)]].map(([k, v]) => <div key={k}><dt className="text-xs text-muted-foreground">{k}</dt><dd className="font-medium">{v}</dd></div>)}
        </dl>
        {i.needsPaymentAcknowledgement && <p className="mb-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-sm">Money was received on this order. <strong>Deleting it does not refund anything.</strong> The payments are kept in the deletion record so finance can reconcile them.</p>}
        <Field label={`Type the order number (${i.number}) to confirm`} required><Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" /></Field>
        <Field label="Why is this order being deleted?" required explain="At least 5 characters. Recorded with your name and the time."><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        {i.needsConfirmedAcknowledgement && <Checkbox label="I understand this order is confirmed and will be permanently removed" checked={ackConf} onChange={(e) => setAckConf(e.target.checked)} />}
        {i.needsPaymentAcknowledgement && <Checkbox label="I understand payments were received and are NOT being refunded by this deletion" checked={ackPay} onChange={(e) => setAckPay(e.target.checked)} />}
        {i.approvedOrPaidCommissions > 0 && <Checkbox label={`I understand ${i.approvedOrPaidCommissions} approved or paid commission entr${i.approvedOrPaidCommissions === 1 ? "y" : "ies"} will be removed and must be settled outside the system`} checked={ackComm} onChange={(e) => setAckComm(e.target.checked)} />}
        {m.error && <p role="alert" className="text-sm text-rose-500">{m.error.message}</p>}
        <div className="mt-3 flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Keep order</Button>
          <Button className="bg-rose-600 text-white hover:bg-rose-700" disabled={m.pending || typed.trim() !== i.number || reason.trim().length < 5 || (i.needsPaymentAcknowledgement && !ackPay) || (i.needsConfirmedAcknowledgement && !ackConf) || (i.approvedOrPaidCommissions > 0 && !ackComm)} onClick={() => void m.run(i)}><Trash2 className="mr-1.5 h-3.5 w-3.5" />Delete permanently</Button></div>
      </>)}</QueryBoundary>
    </Modal>
  );
}
export { Select };
