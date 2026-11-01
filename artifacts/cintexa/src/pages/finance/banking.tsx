import { useState } from "react";
import { Link } from "wouter";
import { ArrowLeftRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, EmptyState, QueryBoundary, Modal, Field, Input, Select, MoneyInput, DataTable } from "@/components/sales/ui";
import { useFinance } from "@/context/FinanceContext";
import { fin, fmtMoney, todayYmd, ymd } from "@/lib/finance/api";
import { useFinanceMutation, useFinanceQuery } from "@/lib/finance/hooks";
import type { Account } from "./accounts";

interface Bank { id: number; name: string; bank_name: string | null; account_ref: string | null; account_code: string; account_name: string; book_balance: string; unmatched_transactions: number; last_reconciled: string | null; is_active: boolean }
interface Transfer { id: number; number: string; entry_date: string; journal_reference: string; description: string; amount: string }

export default function BankingPage() {
  const { can, currency } = useFinance();
  const q = useFinanceQuery<{ items: Bank[] }>("/bank-accounts"); const tr = useFinanceQuery<{ items: Transfer[] }>("/bank-transfers", undefined, { enabled: can("ledger:read") });
  const [reg, setReg] = useState(false); const [xfer, setXfer] = useState(false);
  return (
    <>
      <PageHeader title="Bank accounts" description="Register the cash, bank and mobile-money accounts you hold. Import statements, match them to your books and reconcile - differences are never written off automatically."
        actions={<span className="flex gap-2">{can("payments:approve") && <Button size="sm" variant="outline" onClick={() => setXfer(true)}><ArrowLeftRight className="mr-1.5 h-3.5 w-3.5" />Transfer funds</Button>}{can("finance:update") && <Button size="sm" onClick={() => setReg(true)}><Plus className="mr-1.5 h-3.5 w-3.5" />Register account</Button>}</span>} />
      <QueryBoundary q={q}>{(d) => d.items.length === 0 ? <Panel><EmptyState title="No bank accounts registered" description="Register a ledger account of type cash, bank or mobile money to start importing statements." /></Panel> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{d.items.map((b) => (
          <Link key={b.id} href={`/finance/banking/${b.id}`} className="rounded-xl border bg-card p-4 transition hover:border-primary/50">
            <p className="text-sm font-semibold">{b.name}</p><p className="text-xs text-muted-foreground">{b.bank_name ?? "—"} {b.account_ref ? `· ${b.account_ref}` : ""} · ledger {b.account_code}</p>
            <p className="mt-3 text-2xl font-semibold tabular-nums">{fmtMoney(b.book_balance, currency)}</p><p className="text-xs text-muted-foreground">balance per books</p>
            <p className="mt-2 text-xs">{b.unmatched_transactions ? <span className="text-amber-500">{b.unmatched_transactions} statement line(s) to match</span> : <span className="text-emerald-500">Nothing to match</span>} · {b.last_reconciled ? `reconciled to ${ymd(b.last_reconciled)}` : "never reconciled"}</p>
          </Link>))}</div>)}</QueryBoundary>
      {can("ledger:read") && <Panel title="Recent transfers" flush className="mt-4"><QueryBoundary q={tr}>{(d) => <DataTable caption="Transfers" rows={d.items} rowKey={(x) => x.id} empty={<EmptyState title="No transfers yet" />} columns={[
        { key: "n", header: "Number", render: (x: Transfer) => <span className="font-mono">{x.number}</span> }, { key: "d", header: "Date", render: (x: Transfer) => ymd(x.entry_date) }, { key: "x", header: "Description", hideOnMobile: true, render: (x: Transfer) => x.description },
        { key: "j", header: "Journal", hideOnMobile: true, render: (x: Transfer) => <span className="font-mono text-xs">{x.journal_reference}</span> }, { key: "a", header: "Amount", align: "right", render: (x: Transfer) => fmtMoney(x.amount, currency) }]} />}</QueryBoundary></Panel>}
      {reg && <Register onClose={() => setReg(false)} />}{xfer && <Transfer onClose={() => setXfer(false)} />}
    </>
  );
}

function Register({ onClose }: { onClose: () => void }) {
  const accounts = useFinanceQuery<{ items: Account[] }>("/accounts", { active: "true" }); const existing = useFinanceQuery<{ items: Bank[] }>("/bank-accounts");
  const taken = new Set((existing.data?.items ?? []).map((b) => b.account_code));
  const eligible = (accounts.data?.items ?? []).filter((a) => a.allow_posting && ["cash", "bank", "mobile_money"].includes(a.subtype ?? "") && !taken.has(a.code));
  const [v, setV] = useState({ account_id: "", name: "", bank_name: "", account_ref: "" });
  const save = useFinanceMutation(() => fin.post("/bank-accounts", { account_id: Number(v.account_id), name: v.name, bank_name: v.bank_name || undefined, account_ref: v.account_ref || undefined }), { invalidate: ["/bank-accounts"], success: "Bank account registered", onSuccess: onClose });
  return (
    <Modal open onClose={onClose} title="Register bank account" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={save.pending || !v.account_id || v.name.trim().length < 2} onClick={() => void save.run()}>Register</Button></>}>
      {save.error && <p role="alert" className="mb-3 text-sm text-rose-500">{save.error.message}</p>}
      <Field label="Ledger account" required hint="Cash, bank and mobile-money accounts from your chart of accounts"><Select value={v.account_id} onChange={(e) => setV({ ...v, account_id: e.target.value, name: v.name || (eligible.find((a) => String(a.id) === e.target.value)?.name ?? "") })}><option value="">Select…</option>{eligible.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</Select></Field>
      <Field label="Name" required><Input value={v.name} maxLength={120} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
      <div className="grid gap-x-3 sm:grid-cols-2"><Field label="Bank"><Input value={v.bank_name} onChange={(e) => setV({ ...v, bank_name: e.target.value })} /></Field><Field label="Account reference" hint="Store only a masked number, e.g. ****4421"><Input value={v.account_ref} maxLength={40} onChange={(e) => setV({ ...v, account_ref: e.target.value })} /></Field></div>
    </Modal>
  );
}

function Transfer({ onClose }: { onClose: () => void }) {
  const { currency } = useFinance(); const accounts = useFinanceQuery<{ items: Account[] }>("/accounts", { active: "true" });
  const cash = (accounts.data?.items ?? []).filter((a) => a.allow_posting && ["cash", "bank", "mobile_money"].includes(a.subtype ?? ""));
  const [v, setV] = useState({ from: "", to: "", amount: "", date: todayYmd(), reference: "" });
  const save = useFinanceMutation(() => fin.post("/bank-transfers", { from_account_id: Number(v.from), to_account_id: Number(v.to), amount: v.amount, transfer_date: v.date, reference: v.reference || undefined }), { invalidate: ["/bank-transfers", "/bank-accounts", "/ledger", "/trial-balance", "/dashboard", "/cashbook"], success: (r: any) => `${r.number} posted (${r.journal})`, onSuccess: onClose });
  return (
    <Modal open onClose={onClose} title="Transfer between accounts" description={`Moves money between your own cash/bank accounts (${currency}). One balanced journal is posted.`} footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={save.pending || !v.from || !v.to || v.from === v.to || !v.amount} onClick={() => void save.run()}>Transfer</Button></>}>
      {save.error && <p role="alert" className="mb-3 text-sm text-rose-500">{save.error.message}</p>}
      <div className="grid gap-x-3 sm:grid-cols-2"><Field label="From" required><Select value={v.from} onChange={(e) => setV({ ...v, from: e.target.value })}><option value="">Select…</option>{cash.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</Select></Field>
        <Field label="To" required><Select value={v.to} onChange={(e) => setV({ ...v, to: e.target.value })}><option value="">Select…</option>{cash.filter((a) => String(a.id) !== v.from).map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</Select></Field>
        <Field label="Amount" required><MoneyInput className="text-right" value={v.amount} onChange={(x) => setV({ ...v, amount: x })} /></Field><Field label="Date" required><Input type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} /></Field></div>
      <Field label="Reference"><Input value={v.reference} maxLength={120} onChange={(e) => setV({ ...v, reference: e.target.value })} /></Field>
    </Modal>
  );
}
