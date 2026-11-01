import { useState } from "react";
import { PageHeader, Panel, DataTable, EmptyState, QueryBoundary, StatusBadge, Select, Input, Field, FilterBar, KpiCard } from "@/components/sales/ui";
import { useFinance } from "@/context/FinanceContext";
import { fmtMoney } from "@/lib/finance/api";
import { useFinanceQuery } from "@/lib/finance/hooks";

interface Row { id: number; date: string; reference: string; description: string; receipts: string; payments: string; balance: string; status: string }
export default function CashbookPage() {
  const { currency } = useFinance(); const banks = useFinanceQuery<{ items: { id: number; name: string }[] }>("/bank-accounts");
  const [bank, setBank] = useState(""); const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const q = useFinanceQuery<{ opening_balance: string; total_receipts: string; total_payments: string; closing_balance: string; items: Row[] }>(bank ? "/cashbook" : null, { bank_account_id: bank, from, to });
  return (<>
    <PageHeader title="Cashbook" description="Every receipt and payment through a bank or cash account, straight from the ledger, with its reconciliation status." />
    <FilterBar><Select aria-label="Account" className="w-64" value={bank} onChange={(e) => setBank(e.target.value)}><option value="">Select an account…</option>{(banks.data?.items ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>
      <Field label="From" className="mb-0"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="To" className="mb-0"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field></FilterBar>
    {!bank ? <Panel><EmptyState title="Choose an account" description="Register accounts under Bank accounts first." /></Panel> : <QueryBoundary q={q}>{(d) => (<>
      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4"><KpiCard label="Opening" value={fmtMoney(d.opening_balance, currency)} /><KpiCard label="Receipts" value={fmtMoney(d.total_receipts, currency)} /><KpiCard label="Payments" value={fmtMoney(d.total_payments, currency)} /><KpiCard label="Closing" value={fmtMoney(d.closing_balance, currency)} /></div>
      <Panel flush><DataTable caption="Cashbook" rows={d.items} rowKey={(r) => r.id} empty={<EmptyState title="No entries" />} columns={[
        { key: "d", header: "Date", render: (r: Row) => r.date }, { key: "r", header: "Reference", render: (r: Row) => <span className="font-mono text-xs">{r.reference}</span> }, { key: "x", header: "Description", hideOnMobile: true, render: (r: Row) => r.description },
        { key: "i", header: "Receipts", align: "right", render: (r: Row) => (Number(r.receipts) ? fmtMoney(r.receipts, currency) : "") }, { key: "o", header: "Payments", align: "right", render: (r: Row) => (Number(r.payments) ? fmtMoney(r.payments, currency) : "") },
        { key: "b", header: "Balance", align: "right", render: (r: Row) => fmtMoney(r.balance, currency) }, { key: "s", header: "Bank", render: (r: Row) => <StatusBadge status={r.status} /> }]} /></Panel></>)}</QueryBoundary>}
  </>);
}
