import { useState } from "react";
import { Link, useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, DataTable, EmptyState, QueryBoundary, StatusBadge, Modal, Field, Input, Select, TabBar, Pagination, MoneyInput, KpiCard, ConfirmModal } from "@/components/sales/ui";
import { useFinance } from "@/context/FinanceContext";
import { fin, fmtMoney, todayYmd, ymd } from "@/lib/finance/api";
import { useFinanceMutation, useFinanceQuery } from "@/lib/finance/hooks";
import type { Account } from "./accounts";

interface Txn { id: number; txn_date: string; description: string; reference: string | null; amount: string; status: string; matched_reference: string | null }
interface Recon { statement_date: string; statement_balance: string; book_balance: string; outstanding_deposits: string; unpresented_payments: string; bank_only_items_net: string; adjusted_bank_balance: string; difference: string; balanced: boolean; ready_to_complete: boolean; unmatched_ledger_entries: { ledger_entry_id: number; date: string; reference: string; description: string; amount: string }[]; unmatched_bank_transactions: { id: number; date: string; description: string; amount: string }[] }
type Tab = "transactions" | "import" | "reconcile" | "history";
const PAGE = 50;

export default function BankDetailPage() {
  const { id } = useParams<{ id: string }>(); const { can } = useFinance(); const [tab, setTab] = useState<Tab>("transactions");
  const q = useFinanceQuery<{ items: { id: number; name: string; account_code: string }[] }>("/bank-accounts"); const bank = q.data?.items.find((b) => String(b.id) === id);
  return (
    <>
      <PageHeader title={bank?.name ?? "Bank account"} description={bank ? `Ledger account ${bank.account_code}` : ""} actions={<Link href="/finance/banking"><Button size="sm" variant="outline">All accounts</Button></Link>} />
      <TabBar<Tab> tabs={[{ key: "transactions", label: "Statement lines" }, ...(can("finance:create") ? [{ key: "import" as Tab, label: "Import statement" }] : []), { key: "reconcile", label: "Reconcile" }, { key: "history", label: "History" }]} value={tab} onChange={setTab} />
      {tab === "transactions" ? <Transactions id={id} /> : tab === "import" ? <Import id={id} onDone={() => setTab("transactions")} /> : tab === "reconcile" ? <Reconcile id={id} /> : <History id={id} />}
    </>
  );
}

function Transactions({ id }: { id: string }) {
  const { can, currency } = useFinance(); const [status, setStatus] = useState(""); const [page, setPage] = useState(1); const [sel, setSel] = useState<Txn | null>(null); const [manual, setManual] = useState(false);
  const q = useFinanceQuery<{ items: Txn[]; total: number }>(`/bank-accounts/${id}/transactions`, { status, limit: PAGE, offset: (page - 1) * PAGE });
  const auto = useFinanceMutation(() => fin.post(`/bank-accounts/${id}/auto-match`), { invalidate: ["/bank-accounts", "/bank-transactions"], success: (r: any) => `${r.matched} matched, ${r.left_for_review} left for review` });
  return (<>
    <div className="mb-3 flex flex-wrap items-center gap-2"><Select aria-label="Status" className="w-44" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">All lines</option><option value="unmatched">Unmatched</option><option value="matched">Matched</option><option value="reconciled">Reconciled</option></Select>
      <span className="ml-auto flex gap-2">{can("finance:create") && <Button size="sm" variant="outline" onClick={() => setManual(true)}>Add line manually</Button>}{can("ledger:post") && <Button size="sm" disabled={auto.pending} onClick={() => void auto.run()}>Auto-match exact pairs</Button>}</span></div>
    <Panel flush><QueryBoundary q={q}>{(d) => (<>
      <DataTable caption="Statement lines" rows={d.items} rowKey={(t) => t.id} onRowClick={(t) => setSel(t)} empty={<EmptyState title="No statement lines" description="Import a CSV statement to start matching." />} columns={[
        { key: "d", header: "Date", render: (t: Txn) => ymd(t.txn_date) }, { key: "x", header: "Description", render: (t: Txn) => <>{t.description}{t.reference ? <span className="ml-1 text-xs text-muted-foreground">{t.reference}</span> : null}</> },
        { key: "a", header: "Amount", align: "right", render: (t: Txn) => <span className={Number(t.amount) < 0 ? "text-rose-500" : ""}>{fmtMoney(t.amount, currency)}</span> },
        { key: "m", header: "Matched to", hideOnMobile: true, render: (t: Txn) => t.matched_reference ?? "" }, { key: "s", header: "Status", render: (t: Txn) => <StatusBadge status={t.status} /> }]} />
      <Pagination page={page} pageSize={PAGE} total={d.total} onPage={setPage} /></>)}</QueryBoundary></Panel>
    {sel && <MatchModal txn={sel} onClose={() => setSel(null)} />}{manual && <ManualLine id={id} onClose={() => setManual(false)} />}
  </>);
}

function MatchModal({ txn, onClose }: { txn: Txn; onClose: () => void }) {
  const { can, currency } = useFinance(); const sug = useFinanceQuery<{ items: { ledger_entry_id: number; date: string; reference: string; description: string; days_apart: number }[] }>(txn.status === "unmatched" ? `/bank-transactions/${txn.id}/suggestions` : null);
  const accounts = useFinanceQuery<{ items: Account[] }>("/accounts", { active: "true" }, { enabled: txn.status === "unmatched" && can("ledger:post") }); const [acct, setAcct] = useState("");
  const refresh = { invalidate: ["/bank-accounts", "/bank-transactions", "/ledger", "/trial-balance", "/dashboard", "/cashbook"] };
  const match = useFinanceMutation((entry: number) => fin.post(`/bank-transactions/${txn.id}/match`, { ledger_entry_id: entry }), { ...refresh, success: "Matched", onSuccess: onClose });
  const unmatch = useFinanceMutation(() => fin.post(`/bank-transactions/${txn.id}/unmatch`), { ...refresh, success: "Unmatched", onSuccess: onClose });
  const book = useFinanceMutation(() => fin.post(`/bank-transactions/${txn.id}/book`, { account_id: Number(acct) }), { ...refresh, success: (r: any) => `Booked and matched (${r.journal})`, onSuccess: onClose });
  return (
    <Modal open onClose={onClose} title={`${ymd(txn.txn_date)} · ${fmtMoney(txn.amount, currency)}`} description={txn.description} footer={<Button variant="outline" onClick={onClose}>Close</Button>}>
      {txn.status === "unmatched" ? (<>
        <h3 className="mb-1 text-sm font-semibold">Matching entries in your books</h3>
        <QueryBoundary q={sug}>{(d) => d.items.length === 0 ? <p className="mb-3 text-sm text-muted-foreground">No ledger entry with exactly this amount within 30 days. If the bank charged or paid something you have not recorded, book it below.</p> : <ul className="mb-3 text-sm">{d.items.map((s) => <li key={s.ledger_entry_id} className="flex items-center justify-between border-b py-1.5 last:border-0"><span><span className="font-mono text-xs">{s.reference}</span> · {s.date} · {s.description}<span className="text-xs text-muted-foreground"> ({s.days_apart} d apart)</span></span>{can("ledger:post") && <Button size="sm" disabled={match.pending} onClick={() => void match.run(s.ledger_entry_id)}>Match</Button>}</li>)}</ul>}</QueryBoundary>
        {can("ledger:post") && <><h3 className="mb-1 mt-3 text-sm font-semibold">Not in the books yet? Record it</h3>
          <div className="flex gap-2"><Select aria-label="Other side of the entry" value={acct} onChange={(e) => setAcct(e.target.value)}><option value="">Choose the account (e.g. Bank charges)…</option>{(accounts.data?.items ?? []).filter((a) => a.allow_posting && !["cash", "bank", "mobile_money"].includes(a.subtype ?? "")).map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</Select><Button disabled={!acct || book.pending} onClick={() => void book.run()}>Book it</Button></div>
          {book.error && <p role="alert" className="mt-2 text-sm text-rose-500">{book.error.message}</p>}</>}
      </>) : txn.status === "matched" ? (<><p className="mb-3 text-sm">Matched to <span className="font-mono">{txn.matched_reference}</span>.</p>{can("ledger:post") && <Button variant="outline" disabled={unmatch.pending} onClick={() => void unmatch.run()}>Unmatch</Button>}</>) : <p className="text-sm text-muted-foreground">This line is part of a completed reconciliation and is locked.</p>}
    </Modal>
  );
}

function ManualLine({ id, onClose }: { id: string; onClose: () => void }) {
  const [v, setV] = useState({ txn_date: todayYmd(), description: "", amount: "", reference: "" });
  const save = useFinanceMutation(() => fin.post(`/bank-accounts/${id}/transactions`, v), { invalidate: ["/bank-accounts"], success: "Line added", onSuccess: onClose });
  return (<Modal open onClose={onClose} title="Add statement line" description="For items that are not in a CSV, such as the opening balance. Use a negative amount for money out." footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={save.pending || !v.amount || v.description.length < 2} onClick={() => void save.run()}>Add</Button></>}>
    {save.error && <p role="alert" className="mb-3 text-sm text-rose-500">{save.error.message}</p>}
    <div className="grid gap-x-3 sm:grid-cols-2"><Field label="Date"><Input type="date" value={v.txn_date} onChange={(e) => setV({ ...v, txn_date: e.target.value })} /></Field><Field label="Amount"><Input inputMode="decimal" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} /></Field></div>
    <Field label="Description"><Input value={v.description} maxLength={300} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field></Modal>);
}

function Import({ id, onDone }: { id: string; onDone: () => void }) {
  const [csv, setCsv] = useState(""); const [name, setName] = useState(""); const [fmt, setFmt] = useState("ymd");
  const preview = useFinanceMutation(() => fin.post<any>(`/bank-accounts/${id}/import`, { csv, date_format: fmt, dry_run: true }), { silentError: false });
  const [pv, setPv] = useState<any>(null);
  const run = useFinanceMutation(() => fin.post<any>(`/bank-accounts/${id}/import`, { csv, date_format: fmt, filename: name }), { invalidate: ["/bank-accounts"], success: (r: any) => `${r.imported} imported, ${r.duplicates_skipped} duplicate(s) skipped`, onSuccess: onDone });
  const load = async (f: File | undefined) => { if (!f) return; if (f.size > 2_000_000) { alert("Files over 2 MB are not accepted."); return; } setName(f.name); setCsv(await f.text()); setPv(null); };
  return (
    <Panel><div className="p-4">
      <p className="mb-3 text-sm text-muted-foreground">Upload a CSV with date, description and either one amount column (negative = money out) or separate debit/credit columns. Columns are detected automatically. Re-importing a file or overlapping lines never creates duplicates.</p>
      <div className="grid gap-x-3 sm:grid-cols-2"><Field label="CSV file"><input type="file" accept=".csv,text/csv" aria-label="CSV file" onChange={(e) => void load(e.target.files?.[0])} /></Field>
        <Field label="Date format"><Select value={fmt} onChange={(e) => { setFmt(e.target.value); setPv(null); }}><option value="ymd">YYYY-MM-DD</option><option value="dmy">DD/MM/YYYY</option><option value="mdy">MM/DD/YYYY</option></Select></Field></div>
      <div className="flex gap-2"><Button variant="outline" disabled={!csv || preview.pending} onClick={async () => setPv(await preview.run())}>Preview</Button>
        <Button disabled={!csv || run.pending || !pv || pv.errors?.length > 0} onClick={() => void run.run()}>{run.pending ? "Importing…" : `Import ${pv?.rows ?? ""} lines`}</Button></div>
      {pv && <div className="mt-4 text-sm">{pv.errors?.length ? <ul className="text-rose-500">{pv.errors.map((e: any, i: number) => <li key={i}>Line {e.line}: {e.message}</li>)}</ul> : <p className="text-emerald-500">{pv.rows} line(s) ready{pv.skipped_zero_amount ? `, ${pv.skipped_zero_amount} zero-amount line(s) skipped` : ""}. Detected: date “{pv.mapping.date}”, description “{pv.mapping.description}”, {pv.mapping.amount ? `amount “${pv.mapping.amount}”` : `debit “${pv.mapping.debit}” / credit “${pv.mapping.credit}”`}.</p>}
        {pv.preview?.length > 0 && <table className="mt-2 w-full text-xs"><tbody>{pv.preview.map((r: any) => <tr key={r.line} className="border-b"><td className="py-1">{r.date}</td><td>{r.description}</td><td className="text-right tabular-nums">{r.amount}</td></tr>)}</tbody></table>}</div>}
    </div></Panel>
  );
}

function Reconcile({ id }: { id: string }) {
  const { can, currency } = useFinance(); const [date, setDate] = useState(todayYmd()); const [bal, setBal] = useState(""); const [confirm, setConfirm] = useState(false);
  const ready = /^-?\d+(\.\d{1,2})?$/.test(bal.trim());
  const q = useFinanceQuery<Recon>(ready ? `/bank-accounts/${id}/reconciliation` : null, { statement_date: date, statement_balance: bal.trim() });
  const done = useFinanceMutation(() => fin.post<any>(`/bank-accounts/${id}/reconciliations`, { statement_date: date, statement_balance: bal.trim() }), { invalidate: ["/bank-accounts", "/bank-transactions"], success: (r: any) => `Reconciled - ${r.locked_transactions} line(s) locked`, onSuccess: () => setConfirm(false) });
  return (<>
    <Panel><div className="grid gap-x-3 p-4 sm:grid-cols-3"><Field label="Statement date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field><Field label="Closing balance per statement"><Input inputMode="decimal" className="text-right" aria-label="Closing balance per statement" value={bal} onChange={(e) => setBal(e.target.value)} /></Field></div></Panel>
    {ready && <div className="mt-4"><QueryBoundary q={q}>{(r) => (<>
      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4"><KpiCard label="Statement balance" value={fmtMoney(r.statement_balance, currency)} /><KpiCard label="Balance per books" value={fmtMoney(r.book_balance, currency)} /><KpiCard label="Adjusted bank balance" value={fmtMoney(r.adjusted_bank_balance, currency)} hint="Statement - bank-only items + deposits in transit - unpresented payments" /><KpiCard label="Difference" value={fmtMoney(r.difference, currency)} tone={r.balanced ? "success" : "danger"} /></div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title={`Deposits in transit ${fmtMoney(r.outstanding_deposits, currency)} / unpresented payments ${fmtMoney(r.unpresented_payments, currency)}`} description="In your books, not yet on the statement" flush>{r.unmatched_ledger_entries.length === 0 ? <p className="p-4 text-sm text-muted-foreground">None</p> : <ul className="text-sm">{r.unmatched_ledger_entries.map((e) => <li key={e.ledger_entry_id} className="flex justify-between border-b px-4 py-1.5 last:border-0"><span>{e.date} · <span className="font-mono text-xs">{e.reference}</span> {e.description}</span><span className="tabular-nums">{fmtMoney(e.amount, currency)}</span></li>)}</ul>}</Panel>
        <Panel title={`Bank items not in the books (${r.unmatched_bank_transactions.length})`} description="Book or match these before completing" flush>{r.unmatched_bank_transactions.length === 0 ? <p className="p-4 text-sm text-muted-foreground">None</p> : <ul className="text-sm">{r.unmatched_bank_transactions.map((t) => <li key={t.id} className="flex justify-between border-b px-4 py-1.5 last:border-0"><span>{t.date} · {t.description}</span><span className="tabular-nums">{fmtMoney(t.amount, currency)}</span></li>)}</ul>}</Panel></div>
      <p role="status" className={`mt-3 text-sm ${r.ready_to_complete ? "text-emerald-500" : "text-amber-500"}`}>{r.ready_to_complete ? "Ready to complete." : r.balanced ? "Balanced, but statement lines still need to be booked or matched." : `Out by ${fmtMoney(r.difference, currency)} - find and resolve the difference. It will not be written off automatically.`}</p>
      {can("ledger:post") && <Button className="mt-2" disabled={!r.ready_to_complete || done.pending} onClick={() => setConfirm(true)}>Complete reconciliation</Button>}
    </>)}</QueryBoundary></div>}
    <ConfirmModal open={confirm} onClose={() => setConfirm(false)} onConfirm={() => void done.run()} pending={done.pending} title={`Complete reconciliation to ${date}?`} message="Every matched line up to this date is locked and cannot be unmatched or edited afterwards." confirmLabel="Complete" />
  </>);
}

function History({ id }: { id: string }) {
  const { currency } = useFinance(); const q = useFinanceQuery<{ items: { id: number; statement_date: string; statement_balance: string; book_balance: string; unpresented_payments: string; outstanding_deposits: string; completed_by_label: string; completed_at: string }[] }>(`/bank-accounts/${id}/reconciliations`);
  return <Panel flush><QueryBoundary q={q}>{(d) => <DataTable caption="Completed reconciliations" rows={d.items} rowKey={(r) => r.id} empty={<EmptyState title="Nothing reconciled yet" />} columns={[
    { key: "d", header: "Statement date", render: (r) => ymd(r.statement_date) }, { key: "s", header: "Statement balance", align: "right", render: (r) => fmtMoney(r.statement_balance, currency) }, { key: "b", header: "Books", align: "right", render: (r) => fmtMoney(r.book_balance, currency) },
    { key: "p", header: "Unpresented", align: "right", hideOnMobile: true, render: (r) => fmtMoney(r.unpresented_payments, currency) }, { key: "u", header: "By", hideOnMobile: true, render: (r) => r.completed_by_label }]} />}</QueryBoundary></Panel>;
}
