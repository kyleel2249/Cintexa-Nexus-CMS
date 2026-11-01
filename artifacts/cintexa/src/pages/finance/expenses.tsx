import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, DataTable, StatusBadge, EmptyState, QueryBoundary, Modal, Drawer, Field, Input, Select, MoneyInput, SearchBox, FilterBar, ConfirmModal, Pagination, DefinitionList } from "@/components/sales/ui";
import { useFinance } from "@/context/FinanceContext";
import { fin, fmtMoney, todayYmd, ymd } from "@/lib/finance/api";
import { useFinanceMutation, useFinanceQuery } from "@/lib/finance/hooks";
import type { Account } from "./accounts";

interface Exp { id: number; number: string | null; expense_date: string; payee: string; description: string; reference: string | null; account_id: number; paid_from_account_id: number; tax_code_id: number | null; tax_code: string | null; status: string; net_amount: string; tax_amount: string; recoverable_tax: string; total: string; account_code: string; account_name: string; paid_from_code: string; paid_from_name: string; created_by_label: string | null; approved_by_label: string | null; cancel_reason: string | null }
const PAGE = 25;

export default function ExpensesPage() {
  const { can, currency } = useFinance(); const [status, setStatus] = useState(""); const [search, setSearch] = useState(""); const [page, setPage] = useState(1); const [edit, setEdit] = useState<Exp | "new" | null>(null); const [open, setOpen] = useState<number | null>(null);
  const q = useFinanceQuery<{ items: Exp[]; total: number }>("/expenses", { status, q: search, limit: PAGE, offset: (page - 1) * PAGE });
  const an = useFinanceQuery<{ items: { code: string; name: string; cost: string; share_pct: number }[]; total: string }>("/expenses/analysis/by-category", undefined, { enabled: can("ledger:read") });
  return (<>
    <PageHeader title="Expenses" description="Day-to-day spending paid from a cash or bank account. Draft → approve (not by the person who entered it) → post. Posting records the expense, recoverable input tax and the payment in one entry."
      actions={can("finance:create") ? <Button size="sm" onClick={() => setEdit("new")}><Plus className="mr-1.5 h-3.5 w-3.5" />New expense</Button> : undefined} />
    <FilterBar><SearchBox value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search payee or description…" />
      <Select aria-label="Status" className="w-40" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">All statuses</option>{["draft", "approved", "posted", "cancelled"].map((s) => <option key={s} value={s}>{s}</option>)}</Select></FilterBar>
    <Panel flush><QueryBoundary q={q}>{(d) => (<>
      <DataTable caption="Expenses" rows={d.items} rowKey={(e) => e.id} onRowClick={(e) => setOpen(e.id)} empty={<EmptyState title="No expenses yet" />} columns={[
        { key: "n", header: "Number", render: (e: Exp) => <span className="font-mono">{e.number ?? "Draft"}</span> }, { key: "d", header: "Date", render: (e: Exp) => ymd(e.expense_date) }, { key: "p", header: "Payee", render: (e: Exp) => e.payee },
        { key: "c", header: "Category", hideOnMobile: true, render: (e: Exp) => e.account_name }, { key: "t", header: "Total", align: "right", render: (e: Exp) => fmtMoney(e.total, currency) }, { key: "s", header: "Status", render: (e: Exp) => <StatusBadge status={e.status} /> }]} />
      <Pagination page={page} pageSize={PAGE} total={d.total} onPage={setPage} /></>)}</QueryBoundary></Panel>
    {can("ledger:read") && an.data && an.data.items.length > 0 && <Panel title="Posted spending by category" description="Cost including non-recoverable tax" className="mt-4"><ul className="p-3 text-sm">{an.data.items.map((r) => <li key={r.code} className="mb-2"><div className="flex justify-between"><span>{r.code} · {r.name}</span><span className="tabular-nums">{fmtMoney(r.cost, currency)} · {r.share_pct}%</span></div><div className="mt-1 h-1.5 rounded bg-secondary"><div className="h-1.5 rounded bg-primary" style={{ width: `${Math.min(100, r.share_pct)}%` }} /></div></li>)}</ul></Panel>}
    {edit && <ExpenseForm exp={edit === "new" ? null : edit} onClose={() => setEdit(null)} />}{open !== null && <ExpenseDrawer id={open} onClose={() => setOpen(null)} onEdit={(e) => { setOpen(null); setEdit(e); }} />}
  </>);
}

function ExpenseForm({ exp, onClose }: { exp: Exp | null; onClose: () => void }) {
  const accounts = useFinanceQuery<{ items: Account[] }>("/accounts", { active: "true" }); const taxes = useFinanceQuery<{ items: { id: number; code: string; is_active: boolean }[] }>("/tax-codes");
  const all = accounts.data?.items ?? []; const cats = all.filter((a) => a.allow_posting && ["expense", "asset"].includes(a.type)); const cash = all.filter((a) => a.allow_posting && ["cash", "bank", "mobile_money"].includes(a.subtype ?? ""));
  const [v, setV] = useState({ expense_date: exp ? ymd(exp.expense_date) : todayYmd(), payee: exp?.payee ?? "", description: exp?.description ?? "", reference: exp?.reference ?? "", account_id: exp ? String(exp.account_id) : "", paid_from_account_id: exp ? String(exp.paid_from_account_id) : "", net_amount: exp?.net_amount ?? "", tax_code_id: exp?.tax_code_id ? String(exp.tax_code_id) : "" });
  const save = useFinanceMutation(() => { const b = { ...v, account_id: Number(v.account_id), paid_from_account_id: Number(v.paid_from_account_id), tax_code_id: v.tax_code_id ? Number(v.tax_code_id) : undefined, reference: v.reference || undefined }; return exp ? fin.patch(`/expenses/${exp.id}`, b) : fin.post("/expenses", b); }, { invalidate: ["/expenses"], success: exp ? "Saved" : "Draft saved", onSuccess: onClose });
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  return (<Modal open onClose={onClose} size="lg" title={exp ? "Edit expense" : "New expense"} description="Tax is calculated by the server from the tax configuration when you save." footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={save.pending || !v.payee || !v.description || !v.account_id || !v.paid_from_account_id || !v.net_amount} onClick={() => void save.run()}>{save.pending ? "Saving…" : "Save draft"}</Button></>}>
    {save.error && <p role="alert" className="mb-3 text-sm text-rose-500">{save.error.message}{save.error.issues.length ? ` - ${save.error.issues.map((i) => i.message).join("; ")}` : ""}</p>}
    <div className="grid gap-x-3 sm:grid-cols-2"><Field label="Date" required><Input type="date" value={v.expense_date} onChange={set("expense_date")} /></Field><Field label="Payee" required><Input value={v.payee} maxLength={200} onChange={set("payee")} /></Field>
      <Field label="Category" required><Select value={v.account_id} onChange={set("account_id")}><option value="">Select…</option>{cats.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</Select></Field><Field label="Paid from" required><Select value={v.paid_from_account_id} onChange={set("paid_from_account_id")}><option value="">Select…</option>{cash.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</Select></Field>
      <Field label="Amount before tax" required><MoneyInput className="text-right" value={v.net_amount} onChange={(x) => setV({ ...v, net_amount: x })} /></Field><Field label="Tax"><Select value={v.tax_code_id} onChange={set("tax_code_id")}><option value="">No tax</option>{(taxes.data?.items ?? []).filter((t) => t.is_active).map((t) => <option key={t.id} value={t.id}>{t.code}</option>)}</Select></Field></div>
    <Field label="Description" required><Input value={v.description} maxLength={500} onChange={set("description")} /></Field><Field label="Receipt / reference no."><Input value={v.reference} maxLength={120} onChange={set("reference")} /></Field>
    <p className="text-xs text-muted-foreground">Receipt file uploads are not available yet - record the receipt number for now.</p></Modal>);
}

function ExpenseDrawer({ id, onClose, onEdit }: { id: number; onClose: () => void; onEdit: (e: Exp) => void }) {
  const { can, currency } = useFinance(); const q = useFinanceQuery<{ expense: Exp }>(`/expenses/${id}`); const [dlg, setDlg] = useState<"cancel" | "delete" | null>(null);
  const refresh = { invalidate: ["/expenses", "/ledger", "/trial-balance", "/dashboard", "/bank-accounts", "/cashbook", "/audit"] };
  const approve = useFinanceMutation(() => fin.post(`/expenses/${id}/approve`), { ...refresh, success: "Approved" });
  const post = useFinanceMutation(() => fin.post(`/expenses/${id}/post`), { ...refresh, success: (r: any) => `Posted to the ledger (${r.journal})` });
  const cancel = useFinanceMutation((r: string) => fin.post(`/expenses/${id}/cancel`, { reason: r }), { ...refresh, success: "Cancelled", onSuccess: () => setDlg(null) });
  const del = useFinanceMutation(() => fin.del(`/expenses/${id}`), { ...refresh, success: "Deleted", onSuccess: onClose });
  const x = q.data?.expense;
  return (<Drawer open onClose={onClose} title={x?.number ?? "Draft expense"} subtitle={x ? <StatusBadge status={x.status} /> : undefined} width="max-w-xl" footer={x ? <>
    {can("finance:create") && x.status === "draft" && <Button variant="outline" onClick={() => onEdit(x)}>Edit</Button>}{can("finance:create") && x.status === "draft" && <Button variant="outline" className="text-rose-500" onClick={() => setDlg("delete")}>Delete</Button>}
    {can("finance:create") && ["draft", "approved"].includes(x.status) && <Button variant="outline" onClick={() => setDlg("cancel")}>Cancel</Button>}{can("expenses:approve") && x.status === "draft" && <Button disabled={approve.pending} onClick={() => void approve.run()}>Approve</Button>}
    {can("finance:post") && ["draft", "approved"].includes(x.status) && <Button disabled={post.pending} onClick={() => void post.run()}>Post</Button>}</> : undefined}>
    <QueryBoundary q={q}>{({ expense: e }) => (<><DefinitionList items={[{ label: "Payee", value: e.payee }, { label: "Date", value: ymd(e.expense_date) }, { label: "Description", value: e.description }, { label: "Category", value: `${e.account_code} ${e.account_name}` }, { label: "Paid from", value: `${e.paid_from_code} ${e.paid_from_name}` }, ...(e.reference ? [{ label: "Reference", value: e.reference }] : []), { label: "Entered by", value: e.created_by_label ?? "—" }, { label: "Approved by", value: e.approved_by_label ?? "—" }, ...(e.cancel_reason ? [{ label: "Cancelled because", value: e.cancel_reason }] : [])]} />
      <div className="mt-4 ml-auto max-w-xs space-y-1 text-sm"><div className="flex justify-between"><span>Amount before tax</span><span className="tabular-nums">{fmtMoney(e.net_amount, currency)}</span></div><div className="flex justify-between text-muted-foreground"><span>Tax {e.tax_code ? `(${e.tax_code})` : ""}</span><span className="tabular-nums">{fmtMoney(e.tax_amount, currency)}</span></div>
        {Number(e.recoverable_tax) > 0 && <div className="flex justify-between text-xs text-muted-foreground"><span>of which recoverable as input tax</span><span className="tabular-nums">{fmtMoney(e.recoverable_tax, currency)}</span></div>}<div className="flex justify-between border-t pt-1 font-semibold"><span>Total paid</span><span className="tabular-nums">{fmtMoney(e.total, currency)}</span></div></div></>)}</QueryBoundary>
    <ConfirmModal open={dlg === "cancel"} onClose={() => setDlg(null)} onConfirm={(r) => void cancel.run(r ?? "")} title="Cancel this expense?" confirmLabel="Cancel expense" danger pending={cancel.pending} reasonLabel="Reason" reasonRequired />
    <ConfirmModal open={dlg === "delete"} onClose={() => setDlg(null)} onConfirm={() => void del.run()} title="Delete this draft?" confirmLabel="Delete" danger pending={del.pending} />
  </Drawer>);
}
