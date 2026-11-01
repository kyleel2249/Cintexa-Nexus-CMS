import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, DataTable, StatusBadge, EmptyState, QueryBoundary, Modal, Drawer, Field, Input, Select, MoneyInput, SearchBox, FilterBar, ConfirmModal, Pagination, DefinitionList } from "@/components/sales/ui";
import { useFinance } from "@/context/FinanceContext";
import { fin, fmtMoney, fromMinor, todayYmd, toMinor, ymd } from "@/lib/finance/api";
import { useFinanceMutation, useFinanceQuery } from "@/lib/finance/hooks";
import type { Account } from "./accounts";

export type DocKind = "invoice" | "bill";
interface DocLine { description: string; quantity: string; unit_price: string; net_amount: string; tax_code: string | null; tax_code_id: number | null; tax_amount: string; account_id: number; account_code: string; account_name: string }
interface Doc { id: number; number: string | null; status: string; payment_status: string; total: string; subtotal: string; tax_total: string; amount_paid: string; outstanding: string; due_date: string; notes: string | null; customer_name?: string; supplier_name?: string; customer_id?: number; supplier_id?: number; supplier_ref?: string; reference?: string | null; invoice_date?: string; bill_date?: string; lines: DocLine[]; taxes?: { component: string; rate: string; amount: string }[]; allocations: { amount: string; number: string; payment_date: string; method: string }[]; approved_by_label: string | null; created_by_label: string | null; cancel_reason: string | null }
interface Party { id: number; code: string; name: string; is_active: boolean }
interface TaxCode { id: number; code: string; name: string; is_active: boolean }
const PAGE = 25;
const label = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

const CFG = {
  invoice: { base: "/invoices", partyBase: "/customers", partyKey: "customer_id", partyName: "customer_name", noun: "invoice", title: "Invoices", desc: "Draft → approve → issue. Issuing assigns the invoice number and posts Receivables, Revenue and Tax automatically; issued invoices cannot be edited.", createPerm: "invoices:manage", finalizePerm: "invoices:manage", finalize: "issue", finalizeLabel: "Issue invoice", payPerm: "invoices:manage", payLabel: "Record receipt", dateKey: "invoice_date", accountTypes: ["revenue"], issuedStatus: "issued" },
  bill: { base: "/bills", partyBase: "/suppliers", partyKey: "supplier_id", partyName: "supplier_name", noun: "bill", title: "Supplier bills", desc: "Draft → approve → post. Posting records the expense, recoverable input tax and the amount owed. A supplier's invoice number can only be entered once.", createPerm: "finance:create", finalizePerm: "finance:post", finalize: "post", finalizeLabel: "Post bill", payPerm: "payments:approve", payLabel: "Record payment", dateKey: "bill_date", accountTypes: ["expense", "asset"], issuedStatus: "posted" },
} as const;

export function DocumentsPage({ kind }: { kind: DocKind }) {
  const cfg = CFG[kind]; const { can, currency } = useFinance();
  const [status, setStatus] = useState(""); const [overdue, setOverdue] = useState(false); const [search, setSearch] = useState(""); const [page, setPage] = useState(1);
  const [editor, setEditor] = useState<number | "new" | null>(null); const [open, setOpen] = useState<number | null>(null);
  const q = useFinanceQuery<{ items: Doc[]; total: number }>(cfg.base, { status, q: search, overdue: overdue ? "true" : undefined, limit: PAGE, offset: (page - 1) * PAGE });
  return (
    <>
      <PageHeader title={cfg.title} description={cfg.desc} actions={can(cfg.createPerm) ? <Button size="sm" onClick={() => setEditor("new")}><Plus className="mr-1.5 h-3.5 w-3.5" />New {cfg.noun}</Button> : undefined} />
      <FilterBar>
        <SearchBox value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search number, party or reference…" />
        <Select aria-label="Status" className="w-40" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">All statuses</option>{["draft", "approved", cfg.issuedStatus, "cancelled"].map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={overdue} onChange={(e) => { setOverdue(e.target.checked); setPage(1); }} />Overdue only</label>
      </FilterBar>
      <Panel flush><QueryBoundary q={q}>{(d) => (<>
        <DataTable caption={cfg.title} rows={d.items} rowKey={(r) => r.id} onRowClick={(r) => setOpen(r.id)} empty={<EmptyState title={`No ${cfg.noun}s found`} />} columns={[
          { key: "n", header: "Number", render: (r: Doc) => <span className="font-mono">{r.number ?? "Draft"}</span> }, { key: "p", header: kind === "invoice" ? "Customer" : "Supplier", render: (r: Doc) => (r as any)[cfg.partyName] },
          { key: "d", header: "Date", hideOnMobile: true, render: (r: Doc) => ymd((r as any)[cfg.dateKey]) }, { key: "u", header: "Due", hideOnMobile: true, render: (r: Doc) => ymd(r.due_date) },
          { key: "t", header: "Total", align: "right", render: (r: Doc) => fmtMoney(r.total, currency) }, { key: "o", header: "Outstanding", align: "right", render: (r: Doc) => (r.status === cfg.issuedStatus ? fmtMoney(r.outstanding, currency) : "") },
          { key: "s", header: "Status", render: (r: Doc) => <StatusBadge status={r.payment_status} /> },
        ]} />
        <Pagination page={page} pageSize={PAGE} total={d.total} onPage={setPage} />
      </>)}</QueryBoundary></Panel>
      {editor !== null && <DocEditor kind={kind} id={editor === "new" ? null : editor} onClose={() => setEditor(null)} />}
      {open !== null && <DocDrawer kind={kind} id={open} onClose={() => setOpen(null)} onEdit={(id) => { setOpen(null); setEditor(id); }} />}
    </>
  );
}

interface EL { description: string; quantity: string; unit_price: string; tax_code_id: string; account_id: string }
const blank = (): EL => ({ description: "", quantity: "1", unit_price: "", tax_code_id: "", account_id: "" });
const qtyMinor = (q: string): bigint | null => { if (!/^\d{1,12}(\.\d{1,4})?$/.test(q.trim())) return null; const [i, f = ""] = q.trim().split("."); return BigInt(i + f.padEnd(4, "0")); };

function DocEditor({ kind, id, onClose }: { kind: DocKind; id: number | null; onClose: () => void }) {
  const cfg = CFG[kind]; const { currency } = useFinance();
  const parties = useFinanceQuery<{ items: Party[] }>(cfg.partyBase, { active: "true", limit: 500 });
  const accounts = useFinanceQuery<{ items: Account[] }>("/accounts", { active: "true" });
  const taxes = useFinanceQuery<{ items: TaxCode[] }>("/tax-codes");
  const existing = useFinanceQuery<Record<string, Doc>>(id ? `${cfg.base}/${id}` : null);
  const [party, setParty] = useState(""); const [date, setDate] = useState(todayYmd()); const [due, setDue] = useState(""); const [ref, setRef] = useState(""); const [notes, setNotes] = useState(""); const [lines, setLines] = useState<EL[]>([blank()]);
  useEffect(() => {
    const d = existing.data?.[cfg.noun]; if (!d) return;
    setParty(String((d as any)[cfg.partyKey])); setDate(ymd((d as any)[cfg.dateKey])); setDue(ymd(d.due_date)); setRef(kind === "bill" ? d.supplier_ref ?? "" : d.reference ?? ""); setNotes(d.notes ?? "");
    setLines(d.lines.map((l) => ({ description: l.description, quantity: String(Number(l.quantity)), unit_price: l.unit_price, tax_code_id: l.tax_code_id ? String(l.tax_code_id) : "", account_id: String(l.account_id) })));
  }, [existing.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const accts = useMemo(() => (accounts.data?.items ?? []).filter((a) => a.allow_posting && (cfg.accountTypes as readonly string[]).includes(a.type)), [accounts.data, cfg.accountTypes]);
  const net = useMemo(() => { let t = 0n; let bad = false; for (const l of lines) { const q = qtyMinor(l.quantity); const p = toMinor(l.unit_price); if (q === null || p === null) { bad = true; continue; } t += (q * p + 5000n) / 10000n; } return { t, bad }; }, [lines]);
  const ready = party && date && lines.length > 0 && !net.bad && net.t > 0n && lines.every((l) => l.description.trim() && l.account_id && l.unit_price) && (kind === "invoice" || ref.trim());
  const save = useFinanceMutation(() => {
    const body: Record<string, unknown> = { [cfg.partyKey]: Number(party), [cfg.dateKey]: date, due_date: due || undefined, notes: notes || undefined,
      lines: lines.map((l) => ({ description: l.description, quantity: l.quantity, unit_price: l.unit_price, tax_code_id: l.tax_code_id ? Number(l.tax_code_id) : undefined, account_id: Number(l.account_id) })) };
    if (kind === "bill") body.supplier_ref = ref; else body.reference = ref || undefined;
    return id ? fin.patch(`${cfg.base}/${id}`, body) : fin.post(cfg.base, body);
  }, { invalidate: [cfg.base, "/overview"], success: id ? "Saved" : "Draft saved", onSuccess: onClose });
  const set = (i: number, p: Partial<EL>) => setLines((x) => x.map((l, n) => (n === i ? { ...l, ...p } : l)));
  return (
    <Modal open onClose={onClose} size="xl" title={id ? `Edit ${cfg.noun}` : `New ${cfg.noun}`} description="Tax is calculated by the server from the effective-dated tax configuration when you save."
      footer={<><span className="mr-auto self-center text-sm text-muted-foreground">Subtotal {fmtMoney(fromMinor(net.t), currency)}</span><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!ready || save.pending} onClick={() => void save.run()}>{save.pending ? "Saving…" : "Save draft"}</Button></>}>
      <div className="grid gap-x-3 sm:grid-cols-4">
        <Field label={kind === "invoice" ? "Customer" : "Supplier"} required><Select value={party} onChange={(e) => setParty(e.target.value)}><option value="">Select…</option>{(parties.data?.items ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
        <Field label={kind === "invoice" ? "Invoice date" : "Bill date"} required><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Due date" hint="Defaults to the party's terms"><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        <Field label={kind === "bill" ? "Supplier invoice no." : "Reference"} required={kind === "bill"}><Input value={ref} maxLength={120} onChange={(e) => setRef(e.target.value)} /></Field>
      </div>
      {save.error && <p role="alert" className="mb-3 text-sm text-rose-500">{save.error.message}{save.error.issues.length ? ` - ${save.error.issues.map((i) => i.message).join("; ")}` : ""}</p>}
      <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead><tr className="text-left text-xs text-muted-foreground"><th className="px-1">Description</th><th className="w-20 px-1">Qty</th><th className="w-28 px-1">Unit price</th><th className="w-36 px-1">Tax</th><th className="w-52 px-1">Account</th><th className="w-8" /></tr></thead>
        <tbody>{lines.map((l, i) => (<tr key={i}>
          <td className="p-1"><Input aria-label={`Line ${i + 1} description`} value={l.description} maxLength={300} onChange={(e) => set(i, { description: e.target.value })} /></td>
          <td className="p-1"><Input aria-label={`Line ${i + 1} quantity`} inputMode="decimal" value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value })} /></td>
          <td className="p-1"><MoneyInput aria-label={`Line ${i + 1} unit price`} className="text-right" value={l.unit_price} onChange={(v) => set(i, { unit_price: v })} /></td>
          <td className="p-1"><Select aria-label={`Line ${i + 1} tax`} value={l.tax_code_id} onChange={(e) => set(i, { tax_code_id: e.target.value })}><option value="">No tax</option>{(taxes.data?.items ?? []).filter((t) => t.is_active).map((t) => <option key={t.id} value={t.id}>{t.code}</option>)}</Select></td>
          <td className="p-1"><Select aria-label={`Line ${i + 1} account`} value={l.account_id} onChange={(e) => set(i, { account_id: e.target.value })}><option value="">Select…</option>{accts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</Select></td>
          <td className="p-1">{lines.length > 1 && <button aria-label={`Remove line ${i + 1}`} className="rounded p-1 text-muted-foreground hover:text-rose-500" onClick={() => setLines((x) => x.filter((_, n) => n !== i))}><Trash2 className="h-4 w-4" /></button>}</td></tr>))}</tbody></table></div>
      <Button size="sm" variant="ghost" onClick={() => setLines((x) => [...x, blank()])}><Plus className="mr-1 h-3.5 w-3.5" />Add line</Button>
      <Field label="Notes" className="mt-3"><Input value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} /></Field>
    </Modal>
  );
}

function DocDrawer({ kind, id, onClose, onEdit }: { kind: DocKind; id: number; onClose: () => void; onEdit: (id: number) => void }) {
  const cfg = CFG[kind]; const { can, currency } = useFinance();
  const q = useFinanceQuery<Record<string, Doc>>(`${cfg.base}/${id}`);
  const [dlg, setDlg] = useState<"cancel" | "delete" | "pay" | null>(null);
  const refresh = { invalidate: [cfg.base, "/ledger", "/trial-balance", "/dashboard", "/overview", "/receivables", "/payables", "/payments", "/audit", "/customers", "/suppliers"] };
  const approve = useFinanceMutation(() => fin.post(`${cfg.base}/${id}/approve`), { ...refresh, success: "Approved" });
  const finalize = useFinanceMutation(() => fin.post(`${cfg.base}/${id}/${cfg.finalize}`), { ...refresh, success: (r: any) => `Posted to the ledger (${r.journal})` });
  const cancel = useFinanceMutation((reason: string) => fin.post(`${cfg.base}/${id}/cancel`, { reason }), { ...refresh, success: "Cancelled", onSuccess: () => setDlg(null) });
  const del = useFinanceMutation(() => fin.del(`${cfg.base}/${id}`), { ...refresh, success: "Deleted", onSuccess: onClose });
  const d = q.data?.[cfg.noun]; const ready = d && (d.status === "approved" || (d.status === "draft"));
  return (
    <Drawer open onClose={onClose} width="max-w-3xl" title={d ? d.number ?? `Draft ${cfg.noun}` : label(cfg.noun)} subtitle={d ? <StatusBadge status={d.payment_status} /> : undefined}
      footer={d ? <>
        {can(cfg.createPerm) && d.status === "draft" && <Button variant="outline" onClick={() => onEdit(d.id)}>Edit</Button>}
        {can(cfg.createPerm) && d.status === "draft" && <Button variant="outline" className="text-rose-500" onClick={() => setDlg("delete")}>Delete</Button>}
        {can(cfg.createPerm) && ["draft", "approved"].includes(d.status) && <Button variant="outline" onClick={() => setDlg("cancel")}>Cancel {cfg.noun}</Button>}
        {can("finance:approve") && d.status === "draft" && <Button disabled={approve.pending} onClick={() => void approve.run()}>Approve</Button>}
        {can(cfg.finalizePerm) && ready && <Button disabled={finalize.pending} onClick={() => void finalize.run()}>{cfg.finalizeLabel}</Button>}
        {can(cfg.payPerm) && d.status === cfg.issuedStatus && Number(d.outstanding) > 0 && <Button onClick={() => setDlg("pay")}>{cfg.payLabel}</Button>}
      </> : undefined}>
      <QueryBoundary q={q}>{(r) => { const x = r[cfg.noun]!; return (<>
        <DefinitionList items={[{ label: kind === "invoice" ? "Customer" : "Supplier", value: ((x as any).customer ?? (x as any).supplier)?.name ?? "" }, { label: "Date", value: ymd((x as any)[cfg.dateKey]) }, { label: "Due", value: ymd(x.due_date) },
          ...(x.supplier_ref ? [{ label: "Supplier invoice no.", value: x.supplier_ref }] : []), ...(x.reference ? [{ label: "Reference", value: x.reference }] : []), { label: "Prepared by", value: x.created_by_label ?? "—" }, { label: "Approved by", value: x.approved_by_label ?? "—" },
          ...(x.cancel_reason ? [{ label: "Cancelled because", value: x.cancel_reason }] : [])]} />
        <div className="mt-4 overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-1">Description</th><th className="text-right">Qty</th><th className="text-right">Price</th><th className="text-right">Net</th><th className="text-right">Tax</th><th>Account</th></tr></thead>
          <tbody>{x.lines.map((l, i) => <tr key={i} className="border-b last:border-0"><td className="py-1.5">{l.description}{l.tax_code ? <span className="ml-1 text-xs text-muted-foreground">({l.tax_code})</span> : null}</td><td className="text-right tabular-nums">{Number(l.quantity)}</td><td className="text-right tabular-nums">{fmtMoney(l.unit_price, currency)}</td><td className="text-right tabular-nums">{fmtMoney(l.net_amount, currency)}</td><td className="text-right tabular-nums">{fmtMoney(l.tax_amount, currency)}</td><td className="font-mono text-xs">{l.account_code}</td></tr>)}</tbody></table></div>
        <div className="mt-3 ml-auto max-w-xs space-y-1 text-sm"><div className="flex justify-between"><span>Subtotal</span><span className="tabular-nums">{fmtMoney(x.subtotal, currency)}</span></div>
          {(x.taxes ?? []).map((t) => <div key={t.component} className="flex justify-between text-muted-foreground"><span>{t.component} {Number(t.rate)}%</span><span className="tabular-nums">{fmtMoney(t.amount, currency)}</span></div>)}
          {!x.taxes && Number(x.tax_total) > 0 && <div className="flex justify-between text-muted-foreground"><span>Tax</span><span className="tabular-nums">{fmtMoney(x.tax_total, currency)}</span></div>}
          <div className="flex justify-between border-t pt-1 font-semibold"><span>Total</span><span className="tabular-nums">{fmtMoney(x.total, currency)}</span></div>
          {x.status === cfg.issuedStatus && <><div className="flex justify-between text-muted-foreground"><span>Paid</span><span className="tabular-nums">{fmtMoney(x.amount_paid, currency)}</span></div><div className="flex justify-between font-medium"><span>Outstanding</span><span className="tabular-nums">{fmtMoney(x.outstanding, currency)}</span></div></>}</div>
        {x.allocations.length > 0 && <><h3 className="mb-1 mt-4 text-sm font-semibold">Payments</h3><ul className="text-sm">{x.allocations.map((a, i) => <li key={i} className="flex justify-between border-b py-1 last:border-0"><span><span className="font-mono text-xs">{a.number}</span> · {ymd(a.payment_date)} · {label(a.method)}</span><span className="tabular-nums">{fmtMoney(a.amount, currency)}</span></li>)}</ul></>}
        {dlg === "pay" && <PayModal kind={kind} doc={x} onClose={() => setDlg(null)} />}
      </>); }}</QueryBoundary>
      <ConfirmModal open={dlg === "cancel"} onClose={() => setDlg(null)} onConfirm={(r) => void cancel.run(r ?? "")} title={`Cancel this ${cfg.noun}?`} confirmLabel="Cancel document" danger pending={cancel.pending} reasonLabel="Reason" reasonRequired />
      <ConfirmModal open={dlg === "delete"} onClose={() => setDlg(null)} onConfirm={() => void del.run()} title="Delete this draft?" confirmLabel="Delete" danger pending={del.pending} />
    </Drawer>
  );
}

function PayModal({ kind, doc, onClose }: { kind: DocKind; doc: Doc; onClose: () => void }) {
  const cfg = CFG[kind]; const { currency } = useFinance();
  const accounts = useFinanceQuery<{ items: (Account & { subtype: string | null })[] }>("/accounts", { active: "true" });
  const banks = (accounts.data?.items ?? []).filter((a) => a.allow_posting && ["cash", "bank", "mobile_money"].includes(a.subtype ?? ""));
  const [amount, setAmount] = useState(doc.outstanding); const [date, setDate] = useState(todayYmd()); const [bank, setBank] = useState(""); const [method, setMethod] = useState("bank_transfer"); const [ref, setRef] = useState("");
  const out = toMinor(doc.outstanding) ?? 0n; const amt = toMinor(amount) ?? 0n;
  const pay = useFinanceMutation(() => fin.post(`${cfg.base}/${doc.id}/payments`, { amount, payment_date: date, bank_account_id: Number(bank), method, reference: ref || undefined }), {
    invalidate: [cfg.base, "/ledger", "/trial-balance", "/dashboard", "/receivables", "/payables", "/payments", "/audit", "/customers", "/suppliers"], success: (r: any) => `${r.payment.number} recorded (${r.journal})`, onSuccess: onClose });
  return (
    <Modal open onClose={onClose} title={kind === "invoice" ? "Record customer receipt" : "Record supplier payment"} description={`Outstanding ${fmtMoney(doc.outstanding, currency)}. Part-payments are allowed; over-payments are not.`}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={pay.pending || !bank || amt <= 0n || amt > out} onClick={() => void pay.run()}>{pay.pending ? "Recording…" : "Record"}</Button></>}>
      {pay.error && <p role="alert" className="mb-3 text-sm text-rose-500">{pay.error.message}</p>}
      <div className="grid gap-x-3 sm:grid-cols-2">
        <Field label="Amount" required><MoneyInput className="text-right" value={amount} onChange={setAmount} /></Field>
        <Field label="Date" required><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label={kind === "invoice" ? "Deposit to" : "Pay from"} required><Select value={bank} onChange={(e) => setBank(e.target.value)}><option value="">Select account…</option>{banks.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</Select></Field>
        <Field label="Method"><Select value={method} onChange={(e) => setMethod(e.target.value)}>{["bank_transfer", "cash", "cheque", "mobile_money", "card", "other"].map((m) => <option key={m} value={m}>{label(m)}</option>)}</Select></Field>
      </div>
      <Field label="Reference"><Input value={ref} maxLength={120} onChange={(e) => setRef(e.target.value)} /></Field>
    </Modal>
  );
}
