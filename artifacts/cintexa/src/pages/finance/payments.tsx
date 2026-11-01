import { useState } from "react";
import { PageHeader, Panel, DataTable, EmptyState, QueryBoundary, Select, FilterBar, Pagination, Tag } from "@/components/sales/ui";
import { useFinance } from "@/context/FinanceContext";
import { fmtMoney, ymd } from "@/lib/finance/api";
import { useFinanceQuery } from "@/lib/finance/hooks";

interface P { id: number; direction: string; number: string; payment_date: string; amount: string; method: string; reference: string | null; party_name: string; bank_name: string; journal_reference: string }
const PAGE = 50;
export default function PaymentsPage() {
  const { currency } = useFinance(); const [dir, setDir] = useState(""); const [page, setPage] = useState(1);
  const q = useFinanceQuery<{ items: P[]; total: number }>("/payments", { direction: dir, limit: PAGE, offset: (page - 1) * PAGE });
  return (
    <>
      <PageHeader title="Payments" description="Receipts from customers and payments to suppliers. Each one is posted to the ledger and allocated to specific documents; they cannot be edited or deleted." />
      <FilterBar><Select aria-label="Direction" className="w-48" value={dir} onChange={(e) => { setDir(e.target.value); setPage(1); }}><option value="">Receipts and payments</option><option value="receipt">Customer receipts</option><option value="payment">Supplier payments</option></Select></FilterBar>
      <Panel flush><QueryBoundary q={q}>{(d) => (<>
        <DataTable caption="Payments" rows={d.items} rowKey={(p) => p.id} empty={<EmptyState title="No payments recorded" description="Record a receipt from an issued invoice, or a payment from a posted bill." />} columns={[
          { key: "n", header: "Number", render: (p: P) => <span className="font-mono">{p.number}</span> }, { key: "t", header: "Type", render: (p: P) => <Tag>{p.direction === "receipt" ? "Receipt" : "Payment"}</Tag> },
          { key: "d", header: "Date", render: (p: P) => ymd(p.payment_date) }, { key: "p", header: "Party", render: (p: P) => p.party_name }, { key: "b", header: "Account", hideOnMobile: true, render: (p: P) => p.bank_name },
          { key: "m", header: "Method", hideOnMobile: true, render: (p: P) => p.method.replace("_", " ") }, { key: "j", header: "Journal", hideOnMobile: true, render: (p: P) => <span className="font-mono text-xs">{p.journal_reference}</span> },
          { key: "a", header: "Amount", align: "right", render: (p: P) => fmtMoney(p.amount, currency) },
        ]} />
        <Pagination page={page} pageSize={PAGE} total={d.total} onPage={setPage} />
      </>)}</QueryBoundary></Panel>
    </>
  );
}
