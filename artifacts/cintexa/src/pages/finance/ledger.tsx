import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, DataTable, EmptyState, QueryBoundary, Field, Select, Input, FilterBar, Pagination, KpiCard } from "@/components/sales/ui";
import { useFinance } from "@/context/FinanceContext";
import { fin, fmtMoney, ymd } from "@/lib/finance/api";
import { useFinanceQuery } from "@/lib/finance/hooks";
import { useToast } from "@/hooks/use-toast";
import { JournalDrawer } from "./journals";
import type { Account } from "./accounts";

interface Entry { id: number; entry_date: string; reference: string; journal_id: number; journal_type: string; description: string | null; debit: string; credit: string; running_balance: string; source_module: string | null; source_ref: string | null }
interface Ledger { account: Account; opening_balance: string; closing_balance: string; total_debit: string; total_credit: string; total: number; items: Entry[] }
const PAGE = 100;

export default function LedgerPage() {
  const { can, currency } = useFinance();
  const { toast } = useToast();
  const accounts = useFinanceQuery<{ items: Account[] }>("/accounts", { active: "true" });
  const [account, setAccount] = useState(""); const [from, setFrom] = useState(""); const [to, setTo] = useState(""); const [page, setPage] = useState(1); const [open, setOpen] = useState<number | null>(null);
  const q = useFinanceQuery<Ledger>(account ? "/ledger" : null, { account_id: account, from, to, limit: PAGE, offset: (page - 1) * PAGE });
  const exportCsv = async () => { try { await fin.download("/ledger", { account_id: account, from, to }, "ledger.csv"); } catch (e) { toast({ title: e instanceof Error ? e.message : "Export failed", variant: "destructive" }); } };
  return (
    <>
      <PageHeader title="General ledger" description="Posted entries only, with running balances in the account's normal-balance direction. Click an entry to open its source journal."
        actions={can("reports:export") && account ? <Button size="sm" variant="outline" onClick={() => void exportCsv()}><Download className="mr-1.5 h-3.5 w-3.5" />Export CSV</Button> : undefined} />
      <FilterBar>
        <Select aria-label="Account" className="w-72" value={account} onChange={(e) => { setAccount(e.target.value); setPage(1); }}><option value="">Select an account…</option>{(accounts.data?.items ?? []).filter((a) => a.allow_posting).map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</Select>
        <Field label="From" className="mb-0"><Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} /></Field>
        <Field label="To" className="mb-0"><Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} /></Field>
      </FilterBar>
      {!account ? <Panel><EmptyState title="Choose an account" description="Pick an account to see its transactions and running balance." /></Panel> : (
        <QueryBoundary q={q}>{(d) => (<>
          <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard label="Opening balance" value={fmtMoney(d.opening_balance, currency)} /><KpiCard label="Total debits" value={fmtMoney(d.total_debit, currency)} /><KpiCard label="Total credits" value={fmtMoney(d.total_credit, currency)} /><KpiCard label="Closing balance" value={fmtMoney(d.closing_balance, currency)} />
          </div>
          <Panel flush>
            <DataTable caption={`Ledger for ${d.account.name}`} rows={d.items} rowKey={(r) => r.id} onRowClick={(r) => setOpen(r.journal_id)} empty={<EmptyState title="No posted entries in this range" />} columns={[
              { key: "d", header: "Date", render: (r: Entry) => ymd(r.entry_date) }, { key: "r", header: "Reference", render: (r: Entry) => <span className="font-mono">{r.reference}</span> },
              { key: "x", header: "Description", hideOnMobile: true, render: (r: Entry) => r.description ?? "" },
              { key: "dr", header: "Debit", align: "right", render: (r: Entry) => (Number(r.debit) ? fmtMoney(r.debit, currency) : "") }, { key: "cr", header: "Credit", align: "right", render: (r: Entry) => (Number(r.credit) ? fmtMoney(r.credit, currency) : "") },
              { key: "b", header: "Balance", align: "right", render: (r: Entry) => <span className="font-medium">{fmtMoney(r.running_balance, currency)}</span> },
            ]} />
            <Pagination page={page} pageSize={PAGE} total={d.total} onPage={setPage} />
          </Panel>
        </>)}</QueryBoundary>
      )}
      {open !== null && <JournalDrawer id={open} onClose={() => setOpen(null)} />}
    </>
  );
}
